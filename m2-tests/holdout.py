"""Measure an additional synthetic paper against independently written question-topic pairs."""
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "m2"))
from agent import analyze

notes = """# 关系完整性
主键：在一张表内唯一标识记录的属性或属性组合。
外键：引用另一张表中的键以维护引用完整性。
死锁：并发事务形成循环等待，无法继续执行。"""
exam = """第1题 请判断订单表的主码能否取空值。
第2题 请给出两个事务产生死锁的一种资源请求顺序。
第3题 子表插入一行时，为什么要先检查父表中有对应记录？
第4题 请解释外键与主键在订单表中的不同作用。"""
truth = {("1","主键"), ("2","死锁"), ("3","外键"), ("4","主键"), ("4","外键")}
def source(name, role, text):
    return {"id": name, "role": role, "kind": "line", "segments": [
        {"id": name + str(i), "body": line, "review": False} for i,line in enumerate(text.splitlines())]}
started = time.perf_counter()
out = analyze({"batch":"holdout", "files":[source("n","material",notes), source("p","exam",exam)]})
found = {(q["label"],name) for q in out["questions"] for name in q["matches"]}
print(dict(expected=len(truth), correct=len(found & truth), extra=sorted(found-truth),
           missed=sorted(truth-found), review=len(out["reviews"]), seconds=round(time.perf_counter()-started,2)))
