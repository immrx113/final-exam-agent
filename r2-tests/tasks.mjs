import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

const base = "http://127.0.0.1:18127";
const { chromium } = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const headers = { "Content-Type":"application/json", "X-Review-Request":"1" };
const call = (path, method = "GET", data) => fetch(base + path, { method, headers, body: JSON.stringify(data) });
async function json(path, method, data) {
  const response = await call(path, method, data);
  assert.ok(response.ok, path + " " + response.status);
  return response.json();
}
async function until(read, accepts, label, seconds = 140) {
  const end = Date.now() + seconds * 1000;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (accepts(value)) return value;
    await wait(250);
  }
  throw Error(label + " " + JSON.stringify(value));
}
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", windowsHide: true }).trim();
function versions(id) {
  assert.match(id, /^[a-f0-9-]{36}$/);
  return Number(docker("exec","final-review-r2-mysql-1","sh","-c",
    'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u review -N -D review -e "$1"', "sh",
    "SELECT COUNT(*) FROM analysis_versions WHERE task_id='" + id + "'"));
}
const courseName = "R2试用-" + Date.now();
const { id: course } = await json("/api/courses","POST",{ name: courseName });
const api = "/api/courses/" + course;
async function upload(role, name, content) {
  const body = new FormData();
  body.append("role",role);
  body.append("file",new Blob([content]),name);
  const r = await fetch(base + api + "/files", { method:"POST", headers:{"X-Review-Request":"1"}, body });
  assert.equal(r.status,200);
  return (await r.json()).id;
}
async function batch(files) {
  const { id } = await json(api + "/jobs","POST",{ files });
  await until(() => json(api + "/jobs/" + id), items => items.every(i => i.status === "ready"), "解析");
  return id;
}
const endpoint = job => api + "/jobs/" + job + "/analysis-tasks";
const terminal = id => until(() => json(api + "/analysis-tasks/" + id), t => ["failed","published"].includes(t.state), id);
const material = await upload("material","概念.md","# 数据库\n函数依赖：属性之间的决定关系。");
const paper = await upload("exam","甲卷.md","第1题 解释函数依赖。");
const job = await batch([material,paper]);
const other = await batch([material]);
const browser = await chromium.launch({ channel:"msedge", headless:true });
let brokerStopped = false, redisStopped = false;
try {
  const page = await browser.newPage();
  await page.addInitScript(({course,job}) => {
    sessionStorage.setItem("selected-course",course);
    sessionStorage.setItem("selected-job:" + course, job);
  },{course,job});
  await page.goto(base);
  docker("stop","final-review-r2-broker-1");
  brokerStopped = true;
  let lost;
  await page.route("**/jobs/" + job + "/analysis-tasks", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const r = await route.fetch();
    assert.equal(r.status(),202);
    lost = await r.json();
    await route.abort();
  });
  await page.getByRole("button",{name:"分析本批资料"}).click();
  await until(async () => lost, Boolean, "提交响应");
  await page.reload();
  await page.getByRole("status").filter({hasText:lost.id}).waitFor();
  assert.equal((await json(endpoint(job),"POST",{requestId:lost.requestId})).id,lost.id);
  for (const [j,k] of [[other,lost.requestId],[job,randomUUID()]]) {
    const conflict = await call(endpoint(j),"POST",{requestId:k});
    assert.equal(conflict.status,409);
    assert.equal((await conflict.json()).id,lost.id);
  }
  assert.equal((await call(api,"DELETE")).status,409);
  assert.equal((await call("/api/course/analysis-tasks/" + lost.id)).status,404);
  // Keep an old course response in flight until the other workspace is mounted.
  let arrive, release;
  const arrived = new Promise(ok => { arrive = ok; });
  const released = new Promise(ok => { release = ok; });
  await page.route("**/analysis-tasks/" + lost.id, async route => {
    const result = await route.fetch();
    arrive();
    await released;
    await route.fulfill({response:result}).catch(() => {});
  }, {times:1});
  await Promise.race([arrived, wait(10000).then(()=>{throw Error("未捕获任务轮询");})]);
  const switcher = page.getByLabel("当前课程",{exact:true});
  await switcher.click();
  await page.getByRole("dialog").getByRole("button",{name:"数据库原理",exact:true}).click();
  await page.getByRole("heading",{name:"数据库原理",exact:true}).waitFor();
  release();
  assert.equal(await page.getByRole("status").filter({hasText:lost.id}).count(),0);
  await switcher.click();
  await page.getByRole("dialog").getByRole("button",{name:courseName,exact:true}).click();
  await page.getByRole("status").filter({hasText:lost.id}).waitFor();
  docker("start","final-review-r2-broker-1");
  brokerStopped = false;
  let done = await terminal(lost.id);
  assert.equal(done.state,"published",JSON.stringify(done));
  assert.equal(versions(lost.id),1);
  await page.getByRole("tab",{name:/真题频次/}).waitFor();
  const snapshot = await json(api + "/analysis");
  const topic = snapshot.ranked.find(r => r.count > 0);
  assert.ok(topic);
  const version = api + "/versions/" + snapshot.version;
  const oldExport = await (await call(version + "/export")).text();
  await json(version + "/states/" + topic.id,"PUT",{revision:0,note:"复习记录",completed:true});
  console.log("PASS response loss / reload / conflicts / broker recovery", done.id, done.attempts, done.version);

  docker("stop","final-review-r2-redis-1");
  redisStopped = true;
  const competing = await Promise.all([randomUUID(),randomUUID()].map(requestId =>
    call(endpoint(job),"POST",{requestId})));
  assert.deepEqual(competing.map(r=>r.status).sort(),[202,409]);
  const [again, same] = await Promise.all(competing.map(r => r.json()));
  assert.equal(again.id,same.id);
  assert.notEqual(again.id,lost.id);
  const queued = await until(() => json(api + "/analysis-tasks/" + again.id), t => t.reason?.includes("锁"), "Redis 等待");
  assert.equal(queued.attempts,0);
  assert.equal((await call(api,"DELETE")).status,409);
  assert.equal((await json(api + "/analysis")).version,snapshot.version);
  assert.equal(await (await call(version + "/export")).text(),oldExport);
  assert.equal((await json(version + "/states"))[0].note,"复习记录");
  docker("start","final-review-r2-redis-1");
  redisStopped = false;
  done = await terminal(again.id);
  assert.equal(done.state,"published",JSON.stringify(done));
  assert.notEqual(done.version,snapshot.version);
  assert.equal(versions(done.id),1);
  console.log("PASS Redis downtime / old study and export / new version",done.id,done.attempts,done.version);

  const previousSource = Object.values(snapshot.sources)[0];
  const original = await (await fetch(base + previousSource.url)).text();
  for (const [marker,attempts,code] of [["R2_INVALID",1,502],["R2_TIMEOUT",3,504]]) {
    const extra = await upload("material",marker + ".md",marker);
    const faultJob = await batch([material,paper,extra]);
    const task = await json(endpoint(faultJob),"POST",{requestId:randomUUID()});
    if (attempts > 1) {
      await until(() => json(api + "/analysis-tasks/" + task.id), t => t.state === "retry", "等待重试");
      assert.equal((await call(api,"DELETE")).status,409);
    }
    const failed = await terminal(task.id);
    assert.equal(failed.state,"failed");
    assert.equal(failed.attempts,attempts);
    assert.equal(failed.errorCode,code);
    await page.reload();
    await page.getByLabel("处理批次").selectOption(faultJob);
    await page.getByRole("status").filter({hasText:failed.reason}).waitFor();
    await page.getByRole("button",{name:"重新分析本批资料",exact:true}).waitFor();
    assert.equal(await (await fetch(base + previousSource.url)).text(), original);
    assert.equal((await json(version + "/states"))[0].note,"复习记录");
    assert.equal(await (await call(version + "/export")).text(),oldExport);
    assert.equal(versions(task.id),0);
    assert.equal((await json(api + "/analysis")).version,done.version);
    console.log("PASS failure",marker,task.id,failed.attempts,"versions=0");
  }
  const legacy = await json(api + "/jobs/" + job + "/analysis","POST");
  assert.equal(legacy.job,job);
  assert.equal((await call(api,"DELETE")).status,204);
  assert.equal((await call(api + "/analysis-tasks/" + done.id)).status,404);
  console.log("PASS synchronous compatibility and course deletion");
} finally {
  if (brokerStopped) docker("start","final-review-r2-broker-1");
  if (redisStopped) docker("start","final-review-r2-redis-1");
  await browser.close();
}
