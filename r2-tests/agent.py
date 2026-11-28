"""Integration fixture for the isolated R2 trial. Unmarked samples use the real agent."""
import json
from pathlib import Path
import runpy
import sys
import time

request = json.loads(Path(sys.argv[1]).read_bytes())
text = "\n".join(s["body"] for f in request["files"] for s in f["segments"])
if "R2_INVALID" in text:
    Path(sys.argv[2]).write_text(json.dumps({
        "batch": request["batch"], "topics": [], "questions": [],
        "reviews": [{"reason": "test", "refs": ["outside"]}]
    }), encoding="utf-8")
else:
    if "R2_TIMEOUT" in text:
        time.sleep(60)
    if "R2_SLOW" in text:
        time.sleep(4)
    script = Path(__file__).resolve().parents[1] / "m2" / "agent.py"
    sys.path.insert(0, str(script.parent))
    runpy.run_path(str(script), run_name="__main__")
