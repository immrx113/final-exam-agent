"""Signal that the trial JVM has entered analysis, then outlast its test timeout."""
import os
import time
from pathlib import Path

Path(os.environ["M5_AGENT_ENTERED"]).touch()
time.sleep(12)
