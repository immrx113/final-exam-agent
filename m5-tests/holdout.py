"""Score an independently authored database paper, one annotated question per line."""
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "m2"))
from agent import analyze

lesson = [
    "死锁：事务之间形成循环等待而无法继续执行。",
    "主键：唯一标识表中每行的属性组合。",
    "外键：引用其他表键值以保持一致性的属性。",
]
paper = [
    "第1题 在仓库表中如何选择主键？",
    "第2题 说明主键和外键在入库明细中的不同用途。",
    "第3题 对于死锁，数据库为什么有时需要回滚事务？",
    "第4题 新增明细时，为什么必须先在商品表里找到所填商品编号？",
    "第5题 两个会话各自占用对方仍在等的资源，双方都无法推进，请诊断故障。",
]
truth = {("1", "主键"), ("2", "主键"), ("2", "外键"), ("3", "死锁"), ("4", "外键"), ("5", "死锁")}

def source(role, entries):
    return {"id": role, "role": role, "kind": "line", "segments": [
        {"id": f"{role}-{i}", "body": body, "review": False}
        for i, body in enumerate(entries, 1)
    ]}

start = time.perf_counter()
result = analyze({"batch": "m5-holdout", "files": [source("material", lesson), source("exam", paper)]})
found = {(q["label"], topic) for q in result["questions"] for topic in q["matches"]}
correct = len(found & truth)
review = {ref for item in result["reviews"] for ref in item["refs"] if ref.startswith("exam-")}
print("precision", f"{correct}/{len(found)}", "recall", f"{correct}/{len(truth)}",
      "questions needing review", f"{len(review)}/{len(paper)}", "seconds", round(time.perf_counter()-start, 3))
print("extra", sorted(found-truth), "missed", sorted(truth-found), "review", sorted(review))
