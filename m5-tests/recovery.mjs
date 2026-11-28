import { waitForPublication } from "../r2-tests/publication.mjs";
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {mkdtemp, readFile, stat, unlink} from "node:fs/promises";
import {resolve, join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createRequire} from "node:module";
import {once} from "node:events";
import net from "node:net";

const {chromium} = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const primary = "http://127.0.0.1:18085/api/course/";
const root = "http://127.0.0.1:18086/api/course/";
const headers = {"X-Review-Request":"1"};
const dir = await mkdtemp(resolve(".local/m5-recovery-"));
const marker = join(dir,"entered");
const env = {...process.env, M5_AGENT_ENTERED: marker, REVIEW_SEMANTIC:"0"};
for (const line of (await readFile(".local/m5.env","utf8")).split(/\r?\n/)) {
  const m = line.match(/^(REVIEW_(?:DB_PASSWORD|OBJECT_USER|OBJECT_PASSWORD))=(.+)$/);
  if (m) env[m[1]] = m[2];
}
let service, closed, browser;
async function until(test, message) {
  for (let i=0; i<550; i++) {
    if (await test()) return;
    await delay(200);
  }
  throw Error(message);
}
async function start(fault) {
  const probe = net.createServer();
  await new Promise((ok,fail)=>probe.once("error",fail).listen(18086,"127.0.0.1",ok));
  await new Promise(ok=>probe.close(ok));
  const args = ["-Djava.io.tmpdir="+dir, "-jar","server/target/review-import-1.0.0.jar","--server.port=18086",
    "--spring.datasource.url=jdbc:mysql://127.0.0.1:33315/review?connectionTimeZone=UTC&allowPublicKeyRetrieval=true&sslMode=DISABLED",
    "--review.endpoint=http://127.0.0.1:39015","--spring.data.redis.port=36385","--review.rocketmq-address=127.0.0.1:39885","--review.analysis-topic=M5Recovery"];
  if (fault) args.push("--review.agent=m5-tests/wait_agent.py","--review.agent-timeout-seconds=5");
  service = spawn("java",args,{env,windowsHide:true,stdio:"ignore"});
  closed = once(service,"exit");
  await until(async()=>{
    if (service.exitCode!==null) throw Error("试用 Java 启动失败");
    return fetch(root+"jobs").then(r=>r.ok,()=>false);
  }, "试用 Java 未就绪");
}
async function stop() {
  if (!service) return;
  if (service.exitCode===null) service.kill();
  await closed;
  service = null;
}
const get = async url => {
  const r = await fetch(url);
  assert.equal(r.status,200);
  return r.json();
};
const exportOf = async version => {
  const r = await fetch(root+"versions/"+version+"/export");
  assert.equal(r.status,200);
  return r.text();
};
try {
  const before = await get(primary+"analysis");
  const topic = before.ranked.find(r=>r.topic.name==="函数依赖");
  assert.equal(topic.count,4,"先运行 course.mjs 建立基线");
  const state = async version => (await get(root+"versions/"+version+"/states")).find(s=>s.topic===topic.id);
  const files = (await get(primary+"jobs/"+before.job)).map(i=>i.file);
  const body = new FormData();
  body.append("role","exam");
  body.append("file",new Blob(["第1题 请说明函数依赖的概念并举例。"]),"追加试卷.md");
  const uploaded = await fetch(primary+"files",{method:"POST",headers,body});
  assert.equal(uploaded.status,200);
  files.push((await uploaded.json()).id);
  const submit = await fetch(primary+"jobs",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({files})});
  assert.equal(submit.status,200);
  const {id} = await submit.json();
  await until(async()=>(await get(primary+"jobs/"+id)).every(i=>i.status==="ready"),"追加批次未就绪");
  await start(true);
  const saved = await state(before.version);
  assert.ok(saved.completed && saved.note);
  const md = await exportOf(before.version);
  const unchanged = async () => {
    assert.deepEqual(await get(root+"analysis"),before);
    assert.deepEqual(await state(before.version),saved);
    assert.equal(await exportOf(before.version),md);
  };
  const requestId = crypto.randomUUID();
  const analyze = () => fetch(root+"jobs/"+id+"/analysis",{method:"POST",headers:{...headers,"Idempotency-Key":requestId}});
  const entered = () => until(()=>stat(marker).then(()=>true,()=>false),"未进入 Agent");
  const interrupted = analyze().then(r=>r.status,()=>0);
  await entered();
  await unchanged();
  await stop();
  assert.equal(await interrupted,0);
  await unlink(marker);
  await start(true);
  await unchanged();
  const timeout = analyze();
  await entered();
  await unchanged();
  assert.equal((await timeout).status,504);
  await unchanged();
  await stop();
  await start(false);
  await unchanged();
  browser = await chromium.launch({channel:"msedge"});
  const page = await browser.newPage();
  await page.goto(new URL("/",root).href);
  // Reselect after the initial poll has finished, as on a reopened course.
  await page.getByRole("button",{name:"查看文本与来源"}).first().waitFor();
  await page.getByLabel("处理批次").selectOption(id);
  const [r] = await Promise.all([waitForPublication(page),
    page.getByRole("button",{name:"分析本批资料"}).click()]);
  assert.equal(r.status(),200);
  const after = await r.json();
  assert.notEqual(after.version,before.version);
  assert.equal(after.job,id);
  const row = after.ranked.find(r=>r.id===topic.id);
  assert.deepEqual([row.count,row.papers,after.paperCount],[5,2,4]);
  assert.ok(row.questions.some(q=>q.refs.some(ref=>after.sources[ref].name==="追加试卷.md")));
  assert.equal((await state(after.version)).note,saved.note);
  assert.ok((await state(after.version)).completed);
  assert.equal(await exportOf(before.version),md);
  assert.match(await exportOf(after.version),/命中 5 题，覆盖 2\/4/);
  const warm = await get(root+"analysis");
  const deleted = execFileSync("docker",["exec","final-review-m5-redis-1","redis-cli","DEL","review:m2:"+after.version],{encoding:"utf8"});
  assert.equal(deleted.trim(),"1");
  assert.deepEqual(await get(root+"analysis"),warm);
  console.log("PASS 分析中断、超时、同批页面重试、旧版导出、笔记保留、缓存清除");
} finally {
  await browser?.close();
  await stop();
}
