// Run against a local M1 test course with the directory printed by m0/run.ps1.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const directory = process.argv[2];
if (!directory) throw Error("Pass an M0 sample directory.");
const base = process.env.REVIEW_TEST_URL || "http://127.0.0.1:8080";
const api = base + "/api/course/";
const entries = [
  ["lesson.ppt.pdf", "courseware", 2, "函数依赖"],
  ["lesson.pptx.pdf", "material", 2, "函数依赖"],
  ["lesson.ppt", "courseware", 2, "函数依赖"],
  ["lesson.pptx", "courseware", 2, "函数依赖"],
  ["notes.doc", "material", 2, "候选键"],
  ["notes.docx", "material", 2, "候选键"],
  ["outline.md", "material", 3, "投影"],
  ["clear.png", "exam", 1, "唯一标识"],
  ["unclear.jpg", "exam", 1, ""],
  ["exam.pdf", "exam", 2, ""],
  ["broken.pdf", "exam", 0, ""],
];
async function json(url, options) {
  const response = await fetch(url, options);
  assert.ok(response.ok, url + " " + response.status);
  return response.json();
}
const files = [];
for (const [name, role] of entries) {
  const bytes =
    name === "broken.pdf"
      ? Buffer.from("damaged fixture")
      : await readFile(join(directory, name));
  const body = new FormData();
  body.append("file", new Blob([bytes]), name);
  body.append("role", role);
  const options = {
    method: "POST",
    headers: { "X-Review-Request": "1" },
    body,
  };
  const { id } = await json(api + "files", options);
  assert.equal((await json(api + "files", options)).id, id);
  files.push(id);
  const original = await fetch(api + "files/" + id + "/original");
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
}

const options = {
  method: "POST",
  headers: { "X-Review-Request": "1", "Content-Type": "application/json" },
  body: JSON.stringify({ files }),
};
const { id: job } = await json(api + "jobs", options);
assert.equal((await json(api + "jobs", options)).id, job);
let items;
for (let i = 0; i < 240; i++) {
  items = await json(api + "jobs/" + job);
  if (items.every((item) => ["ready", "failed"].includes(item.status))) break;
  await wait(1000);
}
assert.equal(items.length, entries.length);
for (const [name, role, pos, expected] of entries) {
  const item = items.find((i) => i.name === name);
  assert.equal(item.role, role);
  if (!pos) {
    assert.equal(item.status, "failed");
    assert.ok(item.reason);
    continue;
  }
  assert.equal(item.status, "ready", name + " " + item.reason);
  const sources = await json(
    api + "jobs/" + job + "/" + item.file + "/segments",
  );
  const source = sources.find((s) => s.pos === pos);
  assert.ok(
    source.body.replace(/\s/g, "").includes(expected),
    name + " " + source.body,
  );
  if (["unclear.jpg", "exam.pdf"].includes(name))
    assert.equal(source.review, true);
  const preview = await fetch(base + source.url);
  assert.equal(preview.status, 200);
  if (name.endsWith(".md")) {
    assert.ok(source.url.endsWith("#L3"));
    assert.match(await preview.text(), /id=L3><pre>[^<]*投影/);
  } else if (/\.(png|jpg)$/.test(name)) {
    assert.deepEqual(
      Buffer.from(await preview.arrayBuffer()),
      await readFile(join(directory, name)),
    );
  } else {
    assert.equal(preview.headers.get("content-type"), "image/png");
    assert.deepEqual(
      [...new Uint8Array(await preview.arrayBuffer()).slice(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
  }
  if (name === "exam.pdf") {
    const third = sources.find((s) => s.pos === 3);
    assert.ok(third && third.url !== source.url);
    assert.equal((await fetch(base + third.url)).status, 200);
  }
}
console.log(
  "PASS: 11 files, roles, original bytes, duplicate requests, OCR, source locations, failure isolation. Batch " +
    job,
);
