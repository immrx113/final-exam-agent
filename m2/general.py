"""Build one course vocabulary exclusively from this batch's teaching material."""
import re
import unicodedata

from concepts import MARKER, NOISE, PROSE, SKIP_LINE, explanatory, term_patterns

SUFFIX = re.compile(r"(?:原理|定理|引理|定律|公式|方程|法则|规则|准则|机制|策略|方法|算法|协议|模型|结构|体系|架构|模式|过程|周期|条件|性质|特征|问题|树|图|栈|队列|链表|堆|哈希|散列|排序|查找|复杂度|进程|线程|信号量|管程|死锁|中断|内存|虚存|缓存|页表|分页|分段|置换|调度|磁盘|文件|帧|报文|分组|路由|拥塞|窗口|套接字|寄存器|流水线|总线|接口|自动机|文法|内聚|耦合|测试|矩阵|向量|空间|变换|极限|导数|积分|分布|检验|回归|熵)$")
NOISE_TERM = re.compile(r"^(?:(?:图|表|公式|算法|定理|定义)\s*[0-9一二三四五六七八九十]+|(?:复习|思考|课后|课程|学习|教学|实验|作业|参考|知识)(?:题|思考题|练习|小结|总结|目标|要求|重点|难点|回顾|导读|大纲|提纲|内容|概述|简介)?|引言|绪论|概述|简介|总结|致谢|参考文献|(?:基本|主要|常见|一般|核心|重要)(?:概念|定义|原理|方法|特点|性质|过程|步骤|问题|优缺点))$")
TERM = r"[\u3400-\u9fffA-Za-z0-9+#/ .·-]{2,22}"
PAIR = re.compile(r"([\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9+#/·.-]{1,21})\s*\(\s*(?:又称|亦称|简称|即|英文简称)?([A-Za-z][A-Za-z0-9+#/.-]{1,15}|[\u3400-\u9fff]{2,10})\s*\)")
DEFINITION = re.compile(r"^(" + TERM + r"?)(是指|指的是|定义为|称为|是一种|是一类|:)(.+)$")
HEADING = re.compile(r"^#{3,6}\s+(.+)")
CHAPTER = re.compile(r"^(?:#{1,2}\s+|第[零一二三四五六七八九十百\d]+章\s*)(.+)$")
BULLET = re.compile(r"^(?:[-*•●]|\d+[.、]|\(\d+\))\s*")
EMPHASIS = re.compile(r"^(?:\*\*(.+?)\*\*|【([^】]+)】)")
SECTION = re.compile(r"^([一二三四五六七八九十]+)[、.．\s]*(名词解释|概念题|术语解释|简答题|计算题|综合题|选择题|填空题|判断题|论述题|应用题)")
SCORE = re.compile(r"\s*(?:\(\s*\d+\s*分\s*\)|\[\s*\d+\s*pts?\s*\])\s*[。.]?$", re.I)
ASKED = re.compile(r"^(?:请)?(?:什么是|解释|简述|试述|说明|分析)(.+?)(?:的(?:概念|定义|含义|作用|原理|过程|机制|必要条件|特点|区别))?[?？。！!]*$")


def normal(text):
    text = unicodedata.normalize("NFKC", text).strip()
    return re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", text)


def valid(name):
    return (re.fullmatch(TERM, name) and not NOISE.search(name) and not NOISE_TERM.fullmatch(name)
            and (len(re.findall(r"[\u3400-\u9fff]", name)) >= 2 or re.search(r"[A-Za-z]{2}", name)
                 or re.fullmatch(r"[A-Za-z][+#/.-]+[\u3400-\u9fff]", name)))


def heading_name(value):
    value = re.sub(r"^[一二三四五六七八九十]+、\s*", "", value)
    return MARKER.sub("", value, count=1).strip()


def teach(files, topic, review):
    """First collect structural evidence and aliases, then resolve descriptions in source order."""
    known, aliases, documents = set(), {}, []
    for file in files:
        if file["role"] == "exam":
            continue
        rows = []
        for source in file["segments"]:
            for raw in source["body"].splitlines():
                line = normal(raw)
                if source["review"] or SKIP_LINE.search(line):
                    rows.append(("", source))
                    if source["review"]:
                        review("教学原文需核对", [source["id"]])
                    continue
                emphasis = EMPHASIS.match(BULLET.sub("", line))
                line = line.replace("**", "").replace("【", "").replace("】", "")
                heading = HEADING.match(line)
                if heading:
                    line = "### " + heading_name(heading[1])

                def register(match):
                    name, alias = match[1].strip(), match[2]
                    if valid(name) and valid(alias) and alias not in {"选学","了解","掌握","重点","续"} and not re.match(r"[图表]\d", alias):
                        if aliases.get(alias, name) != name:
                            aliases[alias] = None
                        else:
                            aliases[alias] = name
                        return name
                    return match[0]
                line = PAIR.sub(register, line)
                heading = HEADING.match(line)
                definition = DEFINITION.fullmatch(BULLET.sub("", line))
                if heading:
                    name = heading_name(heading[1]).split("(")[0].strip()
                elif emphasis:
                    name = PAIR.sub(register, emphasis[1] or emphasis[2]).strip()
                elif definition:
                    name = definition[1].strip()
                    if definition[2] == ":" and not (SUFFIX.search(name) or PROSE.search(definition[3])):
                        name = ""
                else:
                    name = ""
                if valid(name):
                    known.add(name)
                rows.append((line, source))
        documents.append((file["kind"], rows))

    aliases = {k:v for k,v in aliases.items() if v in known}
    subjects = term_patterns(known) if known else None
    for kind, rows in documents:
        chapter = "待归类"
        for i, (line, source) in enumerate(rows):
            if not line:
                continue
            ref = source["id"]
            heading = HEADING.match(line)
            title = heading_name(heading[1]) if heading else line
            chapter_match = CHAPTER.match(title)
            if chapter_match:
                chapter = chapter_match[1].strip()
                continue
            bare = BULLET.sub("", title).strip()
            definition = DEFINITION.fullmatch(bare)
            if definition and definition[1].strip() in known and explanatory(definition[3]):
                name = definition[1].strip()
                topic(aliases.get(name, name), chapter, definition[3].strip(), [ref], 3)
                continue
            name = bare.split("(")[0].strip()
            if name not in known:
                match = subjects.match(bare) if subjects else None
                if match and explanatory(bare[match.end():]) and PROSE.search(bare[match.end():]):
                    name = aliases.get(match[0], match[0])
                    topic(name, chapter, bare, [ref], 1)
                continue
            name = aliases.get(name, name)
            topic(name, chapter, "教学资料列出“" + name + "”，可打开出处查看上下文。", [ref])
            points, refs = [], [ref]
            for following, src in rows[i+1:i+5]:
                if (not following or following.startswith("#") or CHAPTER.match(following)
                        or kind != "line" and src["id"] != ref or DEFINITION.fullmatch(following)):
                    break
                bullet = BULLET.match(following)
                if not bullet and (kind == "line" or not heading):
                    if not points and explanatory(following) and PROSE.search(following):
                        topic(name, chapter, following, [ref,src["id"]], 2)
                    break
                point = BULLET.sub("", following).strip()
                if not point or NOISE_TERM.fullmatch(point):
                    break
                points.append(point)
                refs.append(src["id"])
                if len(points) == 3:
                    break
            if len(points) >= 2 or points and explanatory(points[0]):
                topic(name, chapter, "；".join(points), refs, 2)
    return aliases
