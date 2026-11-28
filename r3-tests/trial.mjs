// Run from the repository root against the R2 trial containers and a fresh schema.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { exercise } from "./workflow.mjs";
import { markedPaper } from "./marked-paper.mjs";

const [jar = "server/target/review-import-1.0.0.jar", oldJar, oldAgent] = process.argv.slice(2);
assert.equal(Boolean(oldJar), Boolean(oldAgent), "升级测试需要 V7 JAR 及配套 Agent");
const schema = "r3_" + Date.now();
const base = "http://127.0.0.1:18130";
const dir = await mkdtemp(".local/r3-test-");
const env = {...process.env, REVIEW_MINIO_PORT:"39027", REVIEW_REDIS_PORT:"36397",
  REVIEW_MQ_PORT:"39897", REVIEW_SEMANTIC:"0", PYTHONUTF8:"1"};
for (const line of (await readFile(".local/r2.env", "utf8")).trim().split(/\r?\n/)) {
  const [key, value] = line.split("=");
  if (["REVIEW_DB_PASSWORD","REVIEW_OBJECT_USER","REVIEW_OBJECT_PASSWORD"].includes(key)) env[key] = value;
}
function sql(statement) {
  return execFileSync("docker", ["exec","final-review-r2-mysql-1","sh","-c",
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -u root -N -e "$1"', "sh", statement],
    {encoding:"utf8", windowsHide:true}).trim();
}
sql("CREATE DATABASE " + schema + " CHARACTER SET utf8mb4; GRANT ALL ON " + schema + ".* TO 'review'@'%'");
let service;
async function stop() {
  if (service && service.exitCode === null && service.signalCode === null) {
    const exit = once(service, "exit");
    service.kill();
    await exit;
  }
}
async function start(file, agent) {
  assert.equal(await fetch(base + "/api/courses").then(() => true, () => false), false, "试用端口已占用");
  const fd = openSync(dir + "/service-" + Date.now() + ".log", "w");
  service = spawn("java", ["-jar", file, "--server.port=18130", "--review.mineru-url=",
    "--review.video-api=http://127.0.0.1:18442", "--review.agent=" + agent, "--review.analysis-topic=Trial" + schema,
    "--spring.datasource.url=jdbc:mysql://127.0.0.1:33327/" + schema + "?connectionTimeZone=UTC&allowPublicKeyRetrieval=true&sslMode=DISABLED"],
    {env, windowsHide:true, stdio:["ignore", fd, fd]});
  closeSync(fd);
  for (let i = 0; i < 240; i++) {
    assert.equal(service.exitCode, null, "试用启动失败，见 " + dir);
    if (await fetch(base + "/api/courses").then(r => r.ok, () => false)) return;
    await wait(250);
  }
  throw Error("启动超时 " + dir);
}
const headers = {"Content-Type":"application/json", "X-Review-Request":"1"};
const call = (path, method = "GET", body) => fetch(base + path, {method, headers, body:JSON.stringify(body)});
async function json(path, method, body) {
  const r = await call(path, method, body);
  assert.ok(r.ok, path + " " + r.status);
  return r.json();
}
async function legacy() {
  const api = "/api/course";
  const files = [];
  for (const [role, content] of [["material","主键：唯一标识一行。"], ["exam","第1题 指出主键。"]]) {
    const form = new FormData();
    form.append("role", role);
    form.append("file", new Blob([content]), role + ".md");
    const r = await fetch(base + api + "/files", {method:"POST",headers:{"X-Review-Request":"1"},body:form});
    files.push((await r.json()).id);
  }
  const {id} = await json(api + "/jobs","POST",{files});
  for (let i=0; i<200; i++) {
    if ((await json(api + "/jobs/" + id)).every(f=>f.status==="ready")) break;
    await wait(250);
  }
  const result = await json(api + "/jobs/" + id + "/analysis", "POST");
  return {result, md:await (await call(api + "/versions/" + result.version + "/export")).text()};
}
try {
  let old;
  if (oldJar) {
    await start(oldJar, oldAgent);
    old = await legacy();
    await stop();
  }
  await start(jar, "r2-tests/agent.py");
  if (old) {
    const path = "/api/course/versions/" + old.result.version;
    assert.deepEqual(await json(path), old.result);
    assert.equal(await (await call(path + "/export")).text(), old.md);
    assert.equal((await call(path + "/corrections","POST",{requestId:randomUUID(),edits:[{}]})).status, 409);
    console.log("PASS V7 upgrade, original snapshot and export");
  }
  const failId = randomUUID();
  sql("USE " + schema + "; CREATE TRIGGER fail_revision BEFORE UPDATE ON analysis_versions FOR EACH ROW " +
    "SET NEW.version_id=IF(NEW.correction_request='" + failId + "',NULL,NEW.version_id)");
  await exercise({base, call, json, failId, restart:async () => { await stop(); await start(jar,"r2-tests/agent.py"); }});
  await markedPaper({base,json});
  const regression = (...args) => execFileSync(process.execPath,args,
    {env:{...env, REVIEW_TEST_URL:base},stdio:"inherit",windowsHide:true});
  for (const script of ["m2-tests/browser.mjs","m3-tests/course.mjs","m2-tests/visibility.mjs","m5-tests/ui-refactor.mjs"])
    regression(script);
  regression("m6-tests/multi-course.mjs","prepare");
  await stop();
  await start(jar,"r2-tests/agent.py");
  regression("m6-tests/multi-course.mjs","verify");
} finally {
  await stop();
}
