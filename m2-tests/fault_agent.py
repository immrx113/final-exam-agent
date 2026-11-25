"""Fault injection for a separate acceptance instance. See README."""
import json
from pathlib import Path
import sys
import time

batch = json.loads(Path(sys.argv[1]).read_bytes())
# The test submits a separate batch for each fault, with a marker in the first line.
if any("超时" in s["body"] for f in batch["files"] for s in f["segments"]):
    time.sleep(10)
result = {"batch": batch["batch"], "topics": [], "questions": [],
          "reviews": [{"reason": "越界", "refs": ["outside-batch"]}]}
Path(sys.argv[2]).write_text(json.dumps(result), encoding="utf-8")
