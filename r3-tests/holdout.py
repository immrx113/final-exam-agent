"""Compare two agent revisions against a fixed annotated paper; no threshold fitting."""
from pathlib import Path
import subprocess
import sys
import tempfile
import json

from test_requirements import document
from agent import analyze


lesson = document("material", "主键：唯一标识表中每行的属性组合。\n外键：引用其他表键值以保持一致性的属性。\n死锁：事务之间形成循环等待而无法继续执行。")
exam = document("exam", "第1题 给出工号作为主键需要满足的条件。\n"
               "第2题 解释外键，并判断为什么退课记录必须对应一条有效选课记录。\n"
               "第3题 指出职员表的主键，并说明职员所属部门为何必须先登记在部门表中。\n"
               "第4题 事务并发造成死锁，请给出一种处理方式。\n"
               "第5题 顺序占用资源时进程发生循环等待而停滞，请诊断故障。\n"
               "第6题 比较主键和外键约束。")
truth = {("1","主键"), ("2","外键"), ("3","主键"), ("3","外键"), ("4","死锁"), ("5","死锁"), ("6","主键"), ("6","外键")}
batch = dict(batch="holdout",files=[lesson,exam])


def score(out):
    questions = out["questions"]
    hits = {(q["label"], name) for q in questions for name in q["matches"]}
    # The legacy agent only flagged zero-match questions and had no per-clause indices.
    pending = {q["label"] for q in questions if any(r["pending"] for r in q["requirements"])
               } if out.get("schema") else {q["label"] for q in questions if not q["matches"]}
    correct = len(hits & truth)
    print("precision", f"{correct}/{len(hits)}", "recall", f"{correct}/{len(truth)}",
          "review", f"{len(pending)}/{len(questions)}", sorted(pending),
          "extra", sorted(hits-truth), "missed", sorted(truth-hits))
    return hits


if __name__ == "__main__":
    if sys.argv[1:] == ["--sample"]:
        print(json.dumps({"lesson":lesson["segments"][0]["body"], "paper":exam["segments"][0]["body"],
                          "truth":sorted(truth), "reviewed":{"2":"外键","3":"外键","4":"死锁","5":"死锁"}}))
        sys.exit(0)
    # Load the baseline's vocabulary and normalisation along with its agent.
    # Keep the original model path so both revisions use the same local encoder.
    with tempfile.TemporaryDirectory() as tmp:
        for name in ("agent", "concepts", "general"):
            source = subprocess.check_output(["git","show",f"bfd0c03:m2/{name}.py"])
            (Path(tmp) / f"{name}.py").write_bytes(source)
        sys.path.insert(0, tmp)
        for name in ("concepts", "general"):
            sys.modules.pop(name, None)
        path = str(Path(__file__).resolve().parents[1] / "m2/agent.py")
        old = {"__file__":path, "__name__":"baseline"}
        exec(compile((Path(tmp)/"agent.py").read_bytes(),path,"exec"),old)
        sys.path.remove(tmp)
    print("R2",end=" ")
    before = score(old["analyze"](batch))
    print("R3",end=" ")
    after = score(analyze(batch))
    print("new incorrect pairs", sorted(after-before-truth))
