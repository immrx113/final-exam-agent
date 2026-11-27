"""M6-03 synthetic general-course fixtures, independent of stored course data."""
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "m2"))
from agent import analyze


def doc(role, *pages):
    return {"id": role, "role": role, "kind": "page", "segments": [
        {"id": role + str(i), "body": body, "review": False} for i, body in enumerate(pages)
    ]}


def batch(lesson, paper):
    return analyze({"profile": "general", "batch": "m6", "files": [lesson, doc("exam", paper)]})


class GeneralCourse(unittest.TestCase):
    def test_os_sections_aliases_and_presentation(self):
        lesson = doc("material", "# 内存管理\n### 2.3 最近最少使用置换算法（LRU）\n• 记录最近访问时间\n• 优先移出最久未使用的页面",
                     "#### 管程（又称监控器）\n保护共享资源的访问\n串行执行临界区操作",
                     "死锁是指多个进程循环等待对方持有的资源。\n**信号量**：用于控制对共享资源的访问。")
        out = batch(lesson, "一、名词解释\n(1) LRU（3分）\n(2) 死锁\n二、简答题\n1. 解释监控器。")
        topics = {t["name"]: t for t in out["topics"]}
        self.assertEqual(set(topics), {"管程","最近最少使用置换算法","死锁","信号量"})
        self.assertIn("；", topics["管程"]["text"])
        self.assertIn("；", topics["最近最少使用置换算法"]["text"])
        self.assertEqual(topics["最近最少使用置换算法"]["chapter"], "内存管理")
        self.assertEqual([q["matches"] for q in out["questions"]], [["最近最少使用置换算法"],["死锁"],["管程"]])

    def test_network_terms_noise_and_latin_boundaries(self):
        out = batch(doc("courseware", "第1章 网络\n### TCP/IP\n### B+树\n### 操作系统（OS）\n### 本章小结\n### 图 2\n### 目录\n### 例题"),
                    "第1题 说明TCP/IP与B+树。\n第2题 POST仅作背景，数据库并发控制和主码。")
        self.assertEqual({t["name"] for t in out["topics"]}, {"TCP/IP","B+树","操作系统"})
        self.assertEqual(out["questions"][1]["matches"], [])
        self.assertEqual(set(out["questions"][0]["matches"]), {"TCP/IP","B+树"})

    def test_definition_precedence_reviews_and_empty_vocabulary(self):
        lesson = doc("material", "### 信号量\n- 服务多个线程\n- 管理并发访问", "信号量是指用于控制并发访问的一种计数机制。", "### 模糊概念")
        lesson["segments"][-1]["review"] = True
        out = batch(lesson, "一、名词解释\n1. 信号量\n2. 页表 [4 pts]")
        topics = {t["name"]:t for t in out["topics"]}
        self.assertEqual(topics["信号量"]["text"], "用于控制并发访问的一种计数机制。")
        self.assertEqual(topics["信号量"]["refs"], ["material0","material1"])
        self.assertEqual(topics["页表"]["chapter"], "待归类")
        self.assertNotIn("模糊概念", topics)
        empty = batch(doc("material","### 目录"), "第1题 阅读数据库视图。")
        self.assertEqual(empty["topics"], [])
        self.assertEqual(empty["questions"][0]["matches"], [])

    @unittest.skipUnless(os.getenv("REVIEW_SEMANTIC") == "1", "requires local BGE")
    def test_general_semantic_uses_course_material(self):
        out = batch(doc("material","互斥锁是指保护共享资源使同一时刻只有一个线程可以进入临界区的工具。\n虚拟内存是指通过磁盘扩展地址空间的管理技术。"),
                    "第1题 同一时间仅允许一个线程进入临界区以保护共享资源，需要使用什么工具？")
        self.assertEqual(out["questions"][0]["matches"], ["互斥锁"])


if __name__ == "__main__":
    unittest.main()
