"""One local batch on stdin, one UTF-8 JSON response on stdout."""
import ctypes
import json
from pathlib import Path
import re
import sys
import time

tools = Path(__file__).resolve().parent / ".tools"
sys.path.insert(0, str(tools / "site"))
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


def peak_working_set_mib():
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in
            ("peak", "working", "peak_paged", "paged", "peak_nonpaged",
             "nonpaged", "pagefile", "peak_pagefile")
        ]

    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    if not ctypes.windll.psapi.GetProcessMemoryInfo(
        ctypes.c_void_p(-1), ctypes.byref(counters), counters.cb
    ):
        raise ctypes.WinError()
    return round(counters.peak / 2**20, 1)


def analyze(batch):
    if batch["version"] != 1:
        raise ValueError("Unsupported batch version")
    start = time.perf_counter()
    tokenizer = Tokenizer.from_file(str(tools / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=512)
    tokenizer.enable_padding()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    model = ort.InferenceSession(str(tools / "model.onnx"), options,
                                 providers=["CPUExecutionProvider"])
    segments, concepts = batch["segments"], batch["concepts"]
    questions = [re.sub(r"\s+", "", s["text"]) for s in segments]
    inputs = tokenizer.encode_batch(
        ["为这个句子生成表示以用于检索相关文章：" + q for q in questions] +
        [c["description"] for c in concepts]
    )
    tensors = {"input_ids": [x.ids for x in inputs],
               "attention_mask": [x.attention_mask for x in inputs],
               "token_type_ids": [x.type_ids for x in inputs]}
    infer_start = time.perf_counter()
    hidden = model.run(None, {i.name: np.asarray(tensors[i.name], dtype=np.int64)
                             for i in model.get_inputs()})[0]
    vectors = hidden[:, 0, :]
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    scores = vectors[:len(segments)] @ vectors[len(segments):].T
    matches = []
    for segment, question, row in zip(segments, questions, scores):
        number = re.search(r"第(\d+)题", question)
        body = re.split(r"第\d+题", question)[-1]
        reason = ""
        if not number or len(re.findall(r"[\u4e00-\u9fff]", body)) < 5:
            reason = "题号或可读题干不足"
        elif row.max() < 0.45 or np.sort(row)[-1] - np.sort(row)[-2] < 0.025:
            reason = "候选相似度低或接近"
        matches.append({"segment": segment["id"], "question": number[1] if number else None,
                        "concept": None if reason else concepts[int(row.argmax())]["id"],
                        "score": round(float(row.max()), 4), "review": reason})
    return {"version": 1, "batch": batch["batch"], "matches": matches,
            "metrics": {"model": "bge-small-zh-v1.5 / ONNX int8 / CPU",
                        "batch_ms": round((time.perf_counter()-start)*1000),
                        "inference_and_matching_ms": round((time.perf_counter()-infer_start)*1000),
                        "agent_peak_working_set_mib": peak_working_set_mib()}}


if __name__ == "__main__":
    response = analyze(json.loads(sys.stdin.buffer.read()))
    sys.stdout.buffer.write(json.dumps(response, ensure_ascii=False, indent=2).encode())
