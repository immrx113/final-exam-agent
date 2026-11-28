// Run prepare before changing REVIEW_PARSER_REVISION and verify after restarting Java.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const host = process.env.REVIEW_TEST_URL;
assert.equal(host, "http://127.0.0.1:18126");
const stateFile = ".local/r1-restart.json";
const mode = process.argv[2];
const headers = { "Content-Type": "application/json", "X-Review-Request": "1" };
async function post(path, body) {
  const r = await fetch(host + path, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(r.ok, true, path + " " + r.status);
  return r;
}
async function json(path) {
  const r = await fetch(host + path);
  assert.equal(r.status, 200);
  return r.json();
}
async function wait(path) {
  for (let i = 0; i < 400; i++) {
    const [item] = await json(path);
    if (["ready","failed"].includes(item.status)) return item;
    await delay(250);
  }
  throw Error("批次未到达终态");
}
if (mode === "prepare") {
  const { id } = await (await post("/api/courses", { name: "R1-重启-" + Date.now() })).json();
  const api = "/api/courses/" + id;
  const ids = [];
  for (const name of ["原文件.md","存储恢复.md","修改配置后.md"]) {
    const body = new FormData();
    body.append("file", new Blob(["课程资料\n# 数据库"]), name);
    body.append("role", "material");
    const r = await fetch(host + api + "/files", { method: "POST", headers: { "X-Review-Request": "1" }, body });
    assert.equal(r.status, 200);
    ids.push((await r.json()).id);
  }
  const { id: job } = await (await post(api + "/jobs", { files: [ids[0]] })).json();
  const first = api + "/jobs/" + job;
  assert.equal((await wait(first)).parseOrigin, "parsed");
  const [s] = await json(first + "/" + ids[0] + "/segments");
  const preview = await (await fetch(host + s.url)).text();
  await writeFile(stateFile, JSON.stringify({ api, ids, first, url: s.url, preview }));
} else {
  const s = JSON.parse(await readFile(stateFile, "utf8"));
  if (mode === "offline") {
    const { id } = await (await post(s.api + "/jobs", { files: [s.ids[1]] })).json();
    s.failed = s.api + "/jobs/" + id;
    const item = await wait(s.failed);
    assert.equal(item.status, "failed");
    assert.match(item.reason, /存储服务/);
    await writeFile(stateFile, JSON.stringify(s));
  } else if (mode === "restored") {
    const deadline = Date.now() + 30000;
    while (true) {
      const ready = await fetch("http://127.0.0.1:39026/minio/health/ready").catch(() => null);
      if (ready?.ok) break;
      assert.ok(Date.now() < deadline, "专用 MinIO 尚未就绪");
      await delay(250);
    }
    await post(s.failed + "/" + s.ids[1] + "/retry");
    const recovered = await wait(s.failed);
    assert.equal(recovered.status, "ready", recovered.reason);
    assert.equal(recovered.parseOrigin, "reused");
  } else {
    assert.equal(mode, "verify");
    const { id } = await (await post(s.api + "/jobs", { files: [s.ids[2]] })).json();
    const path = s.api + "/jobs/" + id;
    assert.equal((await wait(path)).parseOrigin, "parsed");
    const [fresh] = await json(path + "/" + s.ids[2] + "/segments");
    assert.notEqual(new URL(fresh.url, host).search, new URL(s.url, host).search);
    assert.equal((await json(s.first))[0].status, "ready");
    const r = await fetch(host + s.url);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), s.preview);
  }
}
console.log("PASS R1 restart / " + mode);
