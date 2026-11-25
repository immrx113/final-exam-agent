"""Run with python -m unittest discover -s m2-tests. All materials are synthetic."""
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "m2"))
from agent import analyze


def document(name, role, pages, kind="page"):
    return {"id": name, "kind": kind, "role": role, "segments": [
        {"id": f"{name}-{i}", "body": body, "review": review}
        for i, (body, review) in enumerate(pages, 1)]}


class AgentTests(unittest.TestCase):
    def test_layout_sql_token_requires_a_real_clause(self):
        lecture = document("notes", "material", [
            ("ISET子句：指定需要修改的列以及对应的新值。\n"
             "set子句：指定更新的列和新值。\nWHERE子句：指定需要更新的元组。", False)])
        rows = analyze({"batch":"a","files":[lecture]})["topics"]
        self.assertEqual({t["name"] for t in rows}, {"SET 子句","WHERE 子句"})

    def test_noisy_labels_never_become_topics_or_exam_matches(self):
        lecture = document("lecture", "courseware", [
            ("第一章 查询\n主讲：课程教师\n0：序号\nD：一组答案\n课堂小问答：请写下你的理解。\n"
             "囗 4v02：图中记录的示例编号\n桥接索引：x2\n"
             "自然连接：两个关系按共同属性的相等值连接。", False),
            ("### 课堂小问答\n以下是一段例题说明。\n影子分页是指以页表副本保存旧版本。\n"
             "SQL：用于描述数据库操作的结构化查询语言。", False)])
        exam = document("paper", "exam", [
            ("第1题 用自然连接合并关系 D 和 R。\n第2题 什么是课堂小问答？\n"
             "第3题 请说明 NoSQL 中的存储方式。", False)])
        out = analyze({"batch": "a", "files": [lecture, exam]})
        self.assertEqual({t["name"] for t in out["topics"]}, {"自然连接", "影子分页", "SQL"})
        self.assertEqual(out["questions"][0]["matches"], ["自然连接"])
        self.assertNotIn("SQL", out["questions"][2]["matches"])

    def test_definition_supersedes_heading_and_keeps_both_sources(self):
        lecture = document("lecture", "courseware", [
            ("。 2 · 1 函数依赖\n主讲：课程教师", False),
            ("函数依赖：一个属性集合的值可以决定另一个属性集合的值。", False)])
        row, = analyze({"batch":"a","files":[lecture]})["topics"]
        self.assertEqual(row["refs"], ["lecture-1", "lecture-2"])
        self.assertTrue(row["text"].startswith("一个属性集合"))

    def test_layout_chapter_numbered_title_and_question(self):
        lecture = document("lecture", "courseware", [
            ("### 第二章 查询运算\n### 2.1 自然连接 (Natural Join)\n按两个关系共有的属性连接。\n### 图 2", False)])
        exam = document("paper", "exam", [("### 1 . 请用自然连接写出查询。", False)])
        out = analyze({"batch":"layout","files":[lecture,exam]})
        row, = out["topics"]
        self.assertEqual((row["name"],row["chapter"]), ("自然连接","查询运算"))
        self.assertEqual(out["questions"][0]["matches"], ["自然连接"])

    def test_three_paper_fixture_counts_and_sources(self):
        path = Path(__file__).parent / "fixtures"
        inputs = []
        for title,role in [("课件","courseware"),("讲义","material"),
                           ("甲卷","exam"),("乙卷","exam"),("丙卷","exam")]:
            lines = (path / (title + ".md")).read_text("utf-8").splitlines()
            inputs.append(document(title, role, [(line,False) for line in lines], "line"))
        out = analyze({"batch":"a", "files":inputs})
        self.assertEqual({t["name"] for t in out["topics"]}, {"函数依赖", "关系代数", "候选键"})
        for name, expected in [("函数依赖",(4,1)), ("关系代数",(3,3)), ("候选键",(1,1))]:
            hits = [q for q in out["questions"] if name in q["matches"]]
            self.assertEqual((len(hits),len({q["file"] for q in hits})),expected)
        fd = next(t for t in out["topics"] if t["name"]=="函数依赖")
        self.assertEqual(fd["refs"], ["课件-2", "讲义-2"])

    def test_m2_03_dependent_subparts_and_continuation(self):
        exam = document("a", "exam", [
            ("第1题 阅读关系模式。\n(1) 判断函数依赖。", False),
            ("(2) 根据上一问判断候选键。", False)])
        result = analyze({"files": [exam], "batch": "a"})
        self.assertEqual(len(result["questions"]), 1)
        q = result["questions"][0]
        self.assertEqual((q["label"], set(q["matches"])), ("1", {"函数依赖", "候选键"}))
        self.assertEqual(q["refs"], ["a-1", "a-2"])

    def test_m2_05_06_scanned_duplicates_and_uncertainty(self):
        pages = [("第1题 判 断 函 数 依 赖。", False), ("第2题 模糊不清", True)]
        files = [document("a", "exam", pages), document("b", "exam", pages),
                 document("photo", "exam", pages[:1], "image")]
        result = analyze({"files": files, "batch": "a"})
        self.assertEqual(len(result["questions"]), 1)
        self.assertEqual(result["questions"][0]["matches"], ["函数依赖"])
        self.assertEqual([r["refs"] for r in result["reviews"]], [["a-2"], ["b-1", "b-2"], ["photo-1"]])

    @unittest.skipUnless(os.getenv("REVIEW_SEMANTIC") == "1", "requires prepared M0 encoder")
    def test_semantic_paraphrase(self):
        files = [document("lecture","material", [("候选键：最小的能够唯一标识元组的属性集合。\n关系代数：对关系做选择、投影和连接运算。",False)]),
                 document("paper","exam",[("第1题 能唯一标识元组的最小属性集合叫什么？说明为什么不能删除其中任何一个属性。",False)])]
        result = analyze({"files": files, "batch": "a"})
        self.assertEqual(result["questions"][0]["matches"], ["候选键"])
