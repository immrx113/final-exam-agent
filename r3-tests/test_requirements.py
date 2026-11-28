"""R3-01/04. Synthetic questions with known counting units and source locations."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "m2"))
from agent import analyze


def document(role, *pages):
    return {"role": role, "kind": "page", "id": role, "segments": [
        {"body": page, "id": f"{role}-{n}", "review": False} for n, page in enumerate(pages, 1)]}


class Requirements(unittest.TestCase):
    def test_partial_and_cross_page_evidence(self):
        for profile in ["database", "general"]:
            with self.subTest(profile=profile):
                lesson = document("material", "主键：唯一标识表中每行的属性组合。\n外键：引用其他表键值以保持一致性的属性。")
                exam = document("exam", "第1题 指出订单表的主键，", "并说明为什么订单中的客户编号必须在客户表中存在。")
                out = analyze(dict(profile=profile, batch="sample", files=[lesson, exam]))
                q, = out["questions"]
                first, second = q["requirements"]
                self.assertEqual(q["matches"], ["主键"])
                self.assertEqual(first["refs"], ["exam-1"])
                self.assertEqual(second["refs"], ["exam-2"])
                self.assertEqual(second["candidates"], ["外键"])
                self.assertTrue(second["pending"])
                self.assertEqual(out["reviews"][0]["requirement"], 1)

    def test_repeat_background_independent_subparts(self):
        exam = document("exam", "第1题 死锁仅作背景，指出主键，并说明主键作用。\n"
                        "第2题 看以下要求。\n(1) 解释外键。\n(2) 判断外键是否有效。")
        out = analyze(dict(batch="sample", files=[exam]))
        self.assertEqual([(q["label"], q["matches"]) for q in out["questions"]],
                         [("1", ["主键"]), ("2(1)", ["外键"]), ("2(2)", ["外键"])])
        self.assertEqual(len(out["questions"][0]["requirements"]), 2)

    def test_zero_match_still_editable(self):
        exam = document("exam", "第1题 请评述以下做法。")
        q, = analyze(dict(batch="sample", files=[exam]))["questions"]
        r, = q["requirements"]
        self.assertEqual((r["matches"], r["candidates"], r["pending"]), ([], [], True))

    def test_continuation_and_new_instruction_without_punctuation(self):
        exam = document("exam", "第1题 指出订单表的", "主键\n说明外键的用途")
        q, = analyze(dict(batch="sample", files=[exam]))["questions"]
        primary, foreign = q["requirements"]
        self.assertEqual((primary["matches"], primary["refs"]), (["主键"], ["exam-1", "exam-2"]))
        self.assertEqual((foreign["matches"], foreign["refs"]), (["外键"], ["exam-2"]))
