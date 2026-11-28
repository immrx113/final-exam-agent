import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.REVIEW_TEST_URL;
assert.equal(base, "http://127.0.0.1:18126", "请使用 R1 专用试用实例");
const headers = { "X-Review-Request": "1", "Content-Type": "application/json" };
const { chromium } = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const browser = await chromium.launch({ channel: "msedge", headless: true });

async function json(path, body) {
  const response = await fetch(base + path, body === undefined ? {} :
    { method: "POST", headers, body: JSON.stringify(body) });
  assert.ok(response.ok, path + " " + response.status);
  return response.json();
}

async function settled(path) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const items = await json(path);
    assert.ok(items.every(i => i.status !== "failed"), JSON.stringify(items));
    if (items.length && items.every(i => i.status === "ready")) return items;
    await delay(160);
  }
  throw Error("批次超时 " + path);
}

async function compareEvidence(result) {
  const sources = new Map();
  const objects = new Map();
  for (const [ref, source] of Object.entries(result.sources)) {
    const path = source.url.split("#")[0];
    if (!objects.has(path)) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      objects.set(path, createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"));
    }
    sources.set(ref, [source.name, source.role, source.label, source.review, objects.get(path)]);
  }
  return {
    papers: result.paperCount,
    sources: [...sources.values()].sort(),
    topics: result.ranked.map(t => [t.topic.name, t.count, t.papers,
      t.questions.map(q => JSON.stringify([q.label, q.refs.map(r => sources.get(r))])).sort()]).sort()
  };
}

const samples = new URL("../.local/m5-samples/", import.meta.url);
const roles = { courseware: "课件", material: "资料", exam: "试卷" };
const files = [];
for (const [role, name] of [["courseware","lesson.pptx"],["material","讲义.pdf"],
    ["exam","甲卷.md"],["exam","乙卷.pdf"],["exam","散页.png"]]) {
  files.push({ role, name, buffer: await readFile(new URL(name, samples)) });
}
for (let n = 1; n <= 8; n++) files.push({ role: "material", name: "补充" + n + ".md",
  buffer: Buffer.from("# 关系数据理论\n函数依赖：用属性间的决定关系约束关系模式。\n例 " + n) });
const extra = { role: "exam", name: "丙卷.pdf", buffer: await readFile(new URL("丙卷.pdf", samples)) };

async function course(label) {
  const { id } = await json("/api/courses", { name: "R1-" + label + "-" + Date.now() });
  const page = await browser.newPage();
  await page.addInitScript(id => sessionStorage.setItem("selected-course", id), id);
  await page.goto(base);
  return { api: "/api/courses/" + id, page };
}

async function submit({ page, api }, inputs, pickOld = false) {
  if (pickOld) {
    await page.locator(".saved-files summary").click();
    const boxes = page.locator(".saved-files input");
    assert.equal(await boxes.count(), 13);
    for (const box of await boxes.all()) await box.check();
  }
  for (const [role, label] of Object.entries(roles)) {
    const group = inputs.filter(f => f.role === role)
      .map(({ name, buffer }) => ({ name, buffer, mimeType: "application/octet-stream" }));
    if (group.length) await page.getByLabel("选择" + label, { exact: true }).setInputFiles(group);
  }
  const job = page.waitForResponse(r => r.url() === base + api + "/jobs" && r.request().method() === "POST");
  const start = performance.now();
  await page.getByRole("button", { name: "提交处理" }).click();
  const { id } = await (await job).json();
  const path = api + "/jobs/" + id;
  const items = await settled(path);
  return { id, path, items, ms: Math.round(performance.now() - start) };
}

async function publish(path) {
  const start = performance.now();
  const result = await json(path + "/analysis", {});
  return { result, ms: Math.round(performance.now() - start) };
}

async function executionCounts(job) {
  const log = await readFile(process.env.REVIEW_R1_LOG, "utf8");
  const rows = log.split(/\r?\n/).filter(line => line.includes("parse job=" + job.id + " "));
  assert.equal(rows.length, job.items.length);
  const totals = { parses: 0, conversions: 0, rendered: 0, ocrPages: 0 };
  for (const item of job.items) {
    const line = rows.find(r => r.includes("file=" + item.file + " "));
    for (const key of Object.keys(totals)) {
      const value = Number(line.match(new RegExp(key + "=(\\d+)"))[1]);
      if (item.parseOrigin === "reused") assert.equal(value, 0, key);
      totals[key] += value;
    }
  }
  return totals;
}

try {
  const warm = await course("追加");
  const cold = await course("全量");
  const initial = await submit(warm, files);
  assert.equal(initial.items.filter(i => i.parseOrigin === "parsed").length, 13);
  const inc = await submit(warm, [extra], true);
  assert.equal(inc.items.filter(i => i.parseOrigin === "reused").length, 13);
  await warm.page.reload();
  await warm.page.waitForFunction(() =>
    [...document.querySelectorAll(".status-pill")].filter(e => e.textContent.includes("复用已有解析")).length === 13);
  const full = await submit(cold, [...files, extra]);
  assert.equal(full.items.filter(i => i.parseOrigin === "parsed").length, 14);
  const a = await publish(inc.path);
  const b = await publish(full.path);
  assert.ok(a.result.paperCount > 1 && a.result.ranked.some(t => t.count > 0));
  assert.deepEqual(await compareEvidence(a.result), await compareEvidence(b.result));
  const ids = inc.items.map(i => i.file);
  assert.equal((await json(warm.api + "/jobs", { files: ids.reverse() })).id, inc.id);

  const without = inc.items.filter(i => i.name !== extra.name);
  const subset = await json(warm.api + "/jobs", { files: without.map(i => i.file) });
  const smaller = await publish(warm.api + "/jobs/" + subset.id);
  assert.equal(smaller.result.paperCount, a.result.paperCount - 1);
  assert.ok(Object.values(smaller.result.sources).every(s => s.name !== extra.name));

  for (const [job, analysis] of [[inc, a], [full, b]]) {
    const counts = process.env.REVIEW_R1_LOG ? await executionCounts(job) : {};
    console.log(JSON.stringify({ files: job.items.length, job: job.id, readyMs: job.ms, analysisMs: analysis.ms, ...counts }));
  }
  const pdf = inc.items.find(i => i.name === "乙卷.pdf");
  const sharedPath = initial.path + "/" + pdf.file + "/segments";
  const sharedSources = await json(sharedPath);
  const ref = Object.values(a.result.sources).find(s => s.file === pdf.file);
  const original = Buffer.from(await (await fetch(base + ref.url)).arrayBuffer());
  const recheck = await fetch(base + inc.path + "/" + pdf.file + "/recheck", { method: "POST", headers });
  assert.equal(recheck.status, 200);
  assert.ok((await settled(inc.path)).every(i => !i.reason));
  const after = await publish(inc.path);
  const fresh = Object.values(after.result.sources).find(s => s.file === pdf.file);
  assert.notEqual(ref.url, fresh.url);
  assert.deepEqual(await json(sharedPath), sharedSources);
  for (const url of [ref.url, fresh.url]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  }
  assert.equal((await fetch(base + ref.url.replace(warm.api, cold.api))).status, 404);
  console.log("PASS 同课增量、冷解析对照、删卷、同清单重提、重识别版本和跨课隔离");
} finally {
  await browser.close();
}
