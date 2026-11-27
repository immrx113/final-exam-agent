"""Extract review candidates from one imported batch. All references are M1 segment IDs."""
import general
import hashlib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from concepts import (CORE, FOLLOW, KNOWN, MARKER, SKIP_LINE, normalize_clauses, PROSE, explanatory, noun,
                      teaching_definition, teaching_subject, term_name, term_patterns)

NUMBER = re.compile(r"^(?:第\s*([0-9一二三四五六七八九十]+)\s*题|(\d+)\s*[、.．](?!\d))\s*[：:]?\s*(.*)$")
SUB = re.compile(r"^[（(](\d+)[）)]\s*(.*)$")
ASKED_CONCEPT = re.compile(r"^(?:请)?(?:什么是|解释|简述)([\w·-]{2,20}?)(?:的(?:定义|含义|作用|原理))?[?？。！!]*$")
CHAPTER = re.compile(r"^(?:#{1,2}\s+|第[零一二三四五六七八九十百\d]+章\s*)(.+)$")
ALIASES = {"候选码": "候选键", "主码": "主键", "外码": "外键", "BC范式": "BCNF",
           "1NF": "第一范式", "2NF": "第二范式", "3NF": "第三范式", "4NF": "第四范式", "5NF": "第五范式"}


def clean(text):
    text = unicodedata.normalize("NFKC", text).replace("**", "").strip()
    text = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", text)
    for alias, name in ALIASES.items():
        text = text.replace(alias, name)
    text = re.sub(r"(第一范式|第二范式|第三范式|第四范式|第五范式|BCNF)\s*\(\1\)", r"\1", text)
    return normalize_clauses(text)


def semantic_matches(pending, topics, batch):
    """Use the existing M0 local encoder when enabled; uncertain candidates stay open."""
    if not pending or len(topics) < 2 or os.getenv("REVIEW_SEMANTIC") != "1":
        return
    import importlib.util
    path = Path(__file__).resolve().parents[1] / "m0" / "agent.py"
    spec = importlib.util.spec_from_file_location("m0_semantics", path)
    model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)
    concepts = [{"id": t["name"], "description": t["name"] + "，" + t["text"]}
                for t in topics.values() if t["refs"]]
    if len(concepts) < 2:
        return
    for start in range(0, len(pending), 16):
        group = pending[start:start + 16]
        segments = [{"id": i, "text": "第1题 " + task} for i, (_, task) in enumerate(group)]
        result = model.analyze({"version": 1, "batch": batch, "segments": segments, "concepts": concepts})
        for match in result["matches"]:
            if match["concept"] and match["score"] >= 0.65:
                group[match["segment"]][0]["matches"].append(match["concept"])


def lines(file, normalize=clean):
    for source in file["segments"]:
        for raw in source["body"].splitlines() or [""]:
            yield normalize(raw), source


def analyze(batch):
    topics = {}
    questions = []
    reviews = []
    pending = []
    explanation_rank = {}
    review_keys = set()

    def review(reason, refs):
        key = (reason, tuple(dict.fromkeys(refs)))
        if key not in review_keys:
            review_keys.add(key)
            reviews.append({"reason": reason, "refs": list(key[1])})

    def topic(name, chapter, description, refs, rank=0):
        entry = topics.setdefault(name, {"name": name, "chapter": chapter, "text": description, "refs": []})
        if rank > explanation_rank.get(name, -1):
            entry["text"] = description
            explanation_rank[name] = rank
            if chapter != "待归类":
                entry["chapter"] = chapter
        if entry["chapter"] == "待归类":
            entry["chapter"] = chapter
        for ref in refs:
            if ref not in entry["refs"]:
                entry["refs"].append(ref)

    ordered = sorted(batch["files"], key=lambda f: f["role"] != "courseware")
    generic = batch.get("profile") == "general"
    aliases = general.teach(ordered, topic, review) if generic else {}
    normalize = general.normal if generic else clean
    exams = [f for f in ordered if f["role"] == "exam"]
    for file in ([] if generic else ordered):
        if file["role"] == "exam":
            continue
        chapter = "待归类"
        heading = None
        for text, source in lines(file):
            ref = source["id"]
            if source["review"]:
                review("教学原文需核对", [ref])
                heading = None
                continue
            if not text:
                continue
            if SKIP_LINE.search(text):
                heading = None
                continue
            structured = text.startswith("### ")
            title = MARKER.sub("", text[4:].strip(), count=1) if structured else text
            if mark := CHAPTER.match(title):
                chapter = mark[1].strip()
                heading = (chapter, ref) if chapter in KNOWN else None
                continue
            elif structured:
                name = term_name(re.sub(r"\s*\([A-Za-z ,\-]+\)$", "", title))
                if name in KNOWN:
                    topic(name, chapter, "教学资料列出“" + name + "”，可打开出处查看上下文。", [ref])
                heading = (name, ref) if noun(name) else None
                continue
            text = MARKER.sub("", text, count=1).strip()
            if definition := teaching_definition(text):
                topic(definition[0], chapter, definition[1], [ref], rank=3)
                heading = None
                continue
            if heading:
                name, location = heading
                heading = None
                adjacent_definition = FOLLOW.match(text) or (name in text and PROSE.search(text))
                if file["kind"] == "line":
                    adjacent_definition = adjacent_definition or PROSE.search(text)
                if (file["kind"] == "line" or location == ref) and explanatory(text) and adjacent_definition:
                    topic(name, chapter, text, [location, ref], rank=2)
            name = teaching_subject(text)
            if name:
                text = text[text.index(name):]
                if text == name or re.fullmatch(re.escape(name) + r"\s*\([A-Za-z -]+\)\s*", text):
                    topic(name, chapter, "教学资料列出“" + name + "”，可打开出处查看上下文。", [ref])
                    heading = (name, ref)
                elif explanatory(text.replace(name, "", 1)) and PROSE.search(text):
                    topic(name, chapter, text, [ref], rank=1)

    vocabulary = list(aliases) if generic else list(CORE)
    exam_terms = term_patterns([*topics, *vocabulary]) if topics or vocabulary else None
    seen_text = set()
    for file in exams:
        refs = [s["id"] for s in file["segments"]]
        title_text = normalize(file["segments"][0]["body"]) if file["segments"] else ""
        named_single_page = ("试卷" in title_text and re.search(r"共\s*1\s*页", title_text))
        if file["kind"] == "image" and not named_single_page:
            review("单张扫描图的试卷归属待核对", refs)
            continue
        signature = hashlib.sha256(re.sub(r"\s+", "", "".join(s["body"] for s in file["segments"])).encode()).digest()
        if signature in seen_text:
            review("提取的卷面文字相同，疑似重复试卷", refs)
            continue
        seen_text.add(signature)
        candidates = []
        parent = current = None
        section, term_section = "", False
        for text, source in lines(file, normalize):
            text = re.sub(r"^#{1,6}\s+", "", text)
            if generic and (header := general.SECTION.match(text)):
                section = header[1]
                term_section = header[2] in {"名词解释", "概念题", "术语解释"}
                current = parent = None
                continue
            major, minor = NUMBER.match(text), SUB.match(text)
            if generic and term_section and minor:
                text = minor[1] + ". " + minor[2]
                major = NUMBER.match(text)
            if major:
                label = major[1] or major[2]
                if section:
                    label = section + "-" + label
                current = {"label": label, "parts": [], "children": False}
                parent = current
                candidates.append(current)
                text = major[3]
            elif minor and parent:
                parent["children"] = True
                current = {"label": parent["label"] + "(" + minor[1] + ")", "parts": [], "children": False,
                           "parent": parent}
                candidates.append(current)
                text = minor[2]
            elif current is None:
                if source["review"]:
                    review("无法辨认题号", [source["id"]])
                continue
            current["term_section"] = term_section
            current["parts"].append((text, source))

        # Dependent subparts share the parent's counting unit and its source locations.
        dependent = {id(q["parent"]) for q in candidates if "parent" in q and
                     re.search(r"上一问|上小题|第\s*[(（]?\d+[)）]?\s*问的结果",
                               "".join(t for t, _ in q["parts"]))}
        for q in candidates:
            if "parent" in q and id(q["parent"]) in dependent:
                q["parent"]["parts"].extend(q["parts"])
        seen_labels = set()
        if not candidates:
            review("未找到可辨识题号", refs)
        for q in candidates:
            if (q["children"] and id(q) not in dependent) or ("parent" in q and id(q["parent"]) in dependent):
                continue
            parts = q["parts"]
            context = q.get("parent", {}).get("parts", []) + parts
            evidence = list(dict.fromkeys(s["id"] for _, s in context))
            body = "".join(t for t, _ in parts)
            short_term = None
            if q.get("term_section"):
                candidate = general.SCORE.sub("", body).strip(" 。?")
                if general.valid(candidate):
                    short_term = aliases.get(candidate, candidate)
            if q["label"] in seen_labels or any(s["review"] for _, s in context) or (len(body.strip()) < 3 and not short_term):
                review("题号重复或题干识别存疑", evidence)
                continue
            seen_labels.add(q["label"])
            task = re.sub(
                r"(?:无需|不涉及|不考查|不要求|不用|不考虑|背景知识|仅作背景|仅作示例|"
                r"仅提到|仅提及|曾提到|曾提及)[^，。；,;]*", "", body)
            matches = list(dict.fromkeys(aliases.get(n, n) for n in exam_terms.findall(task))) if exam_terms else []
            if short_term:
                matches = [short_term]
            if generic and not matches and (asked := general.ASKED.fullmatch(task)):
                name = asked[1]
                if general.valid(name) and general.SUFFIX.search(name):
                    matches = [name]
            if not generic and not matches and (asked := ASKED_CONCEPT.fullmatch(task)) and noun(asked[1]):
                matches = [asked[1]]
            for name in matches:
                if name not in topics:
                    topic(name, "待归类", "试题涉及" + name + "，教学资料中尚未找到定义。", [])
                    exam_terms = term_patterns([*topics, *vocabulary])
            question = {"file": file["id"], "label": q["label"], "refs": evidence, "matches": matches}
            questions.append(question)
            if not matches:
                pending.append((question, task))
    semantic_matches(pending, topics, batch["batch"])
    for question, _ in pending:
        if not question["matches"]:
            review("未能确定解题需要的知识点", question["refs"])
    return {"batch": batch["batch"], "topics": list(topics.values()), "questions": questions, "reviews": reviews}


if __name__ == "__main__":
    payload = json.loads(Path(sys.argv[1]).read_bytes())
    Path(sys.argv[2]).write_text(json.dumps(analyze(payload), ensure_ascii=False), encoding="utf-8")
