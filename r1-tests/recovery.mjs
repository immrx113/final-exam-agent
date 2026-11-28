import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { delimiter } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const host = process.env.REVIEW_TEST_URL;
assert.equal(host, "http://127.0.0.1:18126");
const headers = { "X-Review-Request": "1" };
const jsonHeaders = { ...headers, "Content-Type": "application/json" };
async function post(url, body) {
  const r = await fetch(host + url, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });
  assert.ok(r.ok, url + " " + r.status);
  return r;
}
const tag = Date.now().toString();
const { id } = await (await post("/api/courses", { name: "R1-故障-" + tag })).json();
const api = "/api/courses/" + id;
async function upload(name, bytes, role = "material") {
  const form = new FormData();
  form.append("file", new Blob([bytes]), name);
  form.append("role", role);
  const r = await fetch(host + api + "/files", { method: "POST", headers, body: form });
  assert.equal(r.status, 200);
  return (await r.json()).id;
}
async function submit(...files) {
  const { id } = await (await post(api + "/jobs", { files })).json();
  return api + "/jobs/" + id;
}
async function settled(path) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    const items = await (await fetch(host + path)).json();
    if (items.length && items.every(i => ["ready","failed"].includes(i.status))) return items;
    await delay(150);
  }
  throw Error("未到达终态 " + path);
}
async function fault(action, file) {
  await promisify(execFile)("java", ["-cp", [".local/r1-test-libs", ".local/r1-test-libs/BOOT-INF/lib/*"].join(delimiter),
    "StorageFault", action, id, file]);
}
const body = "# 数据库\n函数依赖：用属性之间的决定关系约束关系模式。\n" + tag;
const a = await upload("资料.md", body);
const first = await submit(a);
assert.equal((await settled(first))[0].parseOrigin, "parsed");
const renamed = await upload("改名.md", body, "courseware");
const single = await submit(renamed);
assert.equal((await settled(single))[0].parseOrigin, "reused");
const wrong = await upload("错误格式.pdf", body);
assert.equal((await settled(await submit(wrong)))[0].status, "failed");
const changed = await upload("资料.md", body + "改动");
assert.equal((await settled(await submit(changed)))[0].parseOrigin, "parsed");
await fault("corrupt-preview", a);
const repaired = await settled(await submit(a, changed));
assert.equal(repaired.find(i => i.file === a).parseOrigin, "parsed");
assert.equal(repaired.find(i => i.file === changed).parseOrigin, "reused");

const pending = await upload("写入中断.md", "R1 save " + tag);
await fault("block", pending);
let interrupted;
try {
  interrupted = await submit(pending);
  assert.equal((await settled(interrupted))[0].status, "failed");
  await fault("unpublished", pending);
} finally { await fault("release", pending); }
await post(interrupted + "/" + pending + "/retry");
assert.equal((await settled(interrupted))[0].parseOrigin, "parsed");
assert.ok((await settled(await submit(pending, changed))).every(i => i.parseOrigin === "reused"));

// Unique bytes keep the intentionally missing original confined to this test.
const pdf = Buffer.concat([await readFile(".local/m5-samples/讲义.pdf"), Buffer.from("\n%R1 " + tag + "\n")]);
const paper = await upload("重识别.pdf", pdf);
const batch = await submit(paper);
assert.equal((await settled(batch))[0].status, "ready");
const segments = async () => (await fetch(host + batch + "/" + paper + "/segments")).json();
const before = await segments();
await fault("hide-original", paper);
try {
  await post(batch + "/" + paper + "/recheck");
  const [row] = await settled(batch);
  assert.equal(row.status, "ready");
  assert.match(row.reason, /重新识别失败/);
  assert.deepEqual(await segments(), before);
  assert.equal((await fetch(host + before[0].url)).status, 200);
} finally { assert.equal(await upload("重识别.pdf", pdf), paper); }
await post(batch + "/" + paper + "/recheck");
assert.equal((await settled(batch))[0].reason, null);
assert.notEqual((await segments())[0].url, before[0].url);
assert.equal((await fetch(host + before[0].url)).status, 200);
const deleted = await fetch(host + api, { method: "DELETE", headers });
assert.equal(deleted.status, 204);
assert.equal((await fetch(host + before[0].url)).status, 404);
console.log("PASS 改名改用途、字节/格式失效、等长损坏修复、发布失败与重试、重识别失败保留和删课");
