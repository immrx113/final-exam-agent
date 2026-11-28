import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { openSync, closeSync } from "node:fs";
import { readFile, mkdtemp } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

const [m6Jar, r1Jar] = process.argv.slice(2);
assert.ok(m6Jar && r1Jar, "依次传入 V5 和 V6 的旧版可执行 JAR");
const r2Jar = "server/target/review-import-1.0.0.jar";
const dir = await mkdtemp(".local/r2-recovery-");
const schema = "r2_" + Date.now();
const topic = "Recovery" + schema;
const env = { ...process.env, REVIEW_MYSQL_PORT:"33327", REVIEW_MINIO_PORT:"39027",
  REVIEW_REDIS_PORT:"36397", REVIEW_MQ_PORT:"39897", REVIEW_SEMANTIC:"0" };
for (const line of (await readFile(".local/r2.env","utf8")).trim().split(/\r?\n/)) {
  const [key,value] = line.split("=");
  if (["REVIEW_DB_PASSWORD","REVIEW_OBJECT_USER","REVIEW_OBJECT_PASSWORD"].includes(key)) env[key]=value;
}
const docker = (...args) => execFileSync("docker",args,{encoding:"utf8",windowsHide:true}).trim();
function sql(statement) {
  return docker("exec","final-review-r2-mysql-1","sh","-c",
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -u root -N -e "$1"',"sh",statement);
}
sql("CREATE DATABASE " + schema + " CHARACTER SET utf8mb4; GRANT ALL ON " + schema + ".* TO 'review'@'%'");
const processes = new Set();
function child(command,args,options) {
  const proc = spawn(command,args,{windowsHide:true,...options});
  processes.add(proc);
  proc.once("exit",() => processes.delete(proc));
  return proc;
}
async function until(get, check, label, seconds=140) {
  const end = Date.now() + 1000 * seconds;
  let result;
  while (Date.now() < end) {
    result = await get();
    if (check(result)) return result;
    await wait(200);
  }
  throw Error(label + ": " + JSON.stringify(result));
}
async function stop(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const end = once(proc,"exit");
  proc.kill();
  await end;
}
const base = "http://127.0.0.1:18128";
async function start(jar,port=18128) {
  const fd = openSync(dir + "/java-" + port + "-" + Date.now() + ".log","w");
  const args = [];
  if (jar === r2Jar) args.push("-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:"+(port+20000));
  args.push("-jar",jar,"--server.port="+port,
    "--spring.datasource.url=jdbc:mysql://127.0.0.1:33327/"+schema+"?connectionTimeZone=UTC&allowPublicKeyRetrieval=true&sslMode=DISABLED",
    "--review.analysis-topic="+topic,"--review.agent-timeout-seconds=8","--review.mineru-url=",
    "--review.video-api=http://127.0.0.1:1");
  const proc = child("java",args,{ env,stdio:["ignore",fd,fd] });
  closeSync(fd);
  await until(async () => {
    assert.equal(proc.exitCode,null,"Java 启动失败，见 " + dir);
    return fetch("http://127.0.0.1:"+port+"/api/courses").then(r=>r.ok,()=>false);
  },Boolean,"启动 Java");
  return proc;
}
const src = (await readFile("server/src/main/java/local/review/AnalysisQueue.java","utf8")).split(/\r?\n/);
async function breakpoint(port,code,id) {
  const line = src.findIndex(s => s.includes(code)) + 1;
  assert.ok(line);
  const proc = child("java",["--add-modules","jdk.jdi","r2-tests/PauseConsumer.java",String(port+20000),String(line),...(id?[id]:[])],
    {stdio:["pipe","pipe","pipe"]});
  let output = "";
  proc.stdout.on("data",b=>output+=b);
  proc.stderr.on("data",b=>output+=b);
  async function marker(pattern) {
    return until(async () => {
      if (proc.exitCode !== null && !pattern.test(output)) throw Error("调试夹具退出 "+output);
      return output;
    },s=>pattern.test(s),"断点 "+code);
  }
  await marker(/READY/);
  return { paused:()=>marker(/PAUSED/), release:()=>proc.stdin.end("R"), crash:()=>proc.stdin.end("K"),
    finish:async()=>{proc.stdin.end("S"); await marker(/FINISHED/);} };
}
const headers={"Content-Type":"application/json","X-Review-Request":"1"};
const call=(path,method="GET",data)=>fetch(base+path,{method,headers,body:JSON.stringify(data)});
async function json(path,method,data) {
  const r=await call(path,method,data);
  assert.ok(r.ok,path+" "+r.status);
  return r.json();
}
async function bytes(url) {
  const r=await fetch(base+url);
  assert.equal(r.status,200);
  return createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex");
}
let api, brokerStopped=false, redisStopped=false;
async function upload(role,name,body) {
  const form=new FormData(); form.append("role",role); form.append("file",new Blob([body]),name);
  const r=await fetch(base+api+"/files",{method:"POST",headers:{"X-Review-Request":"1"},body:form});
  assert.equal(r.status,200); return (await r.json()).id;
}
async function batch(files) {
  const {id}=await json(api+"/jobs","POST",{files});
  await ready(id);
  return id;
}
const ready=job=>until(()=>json(api+"/jobs/"+job),items=>items.every(i=>i.status==="ready"),"解析批次");
const submit=job=>json(api+"/jobs/"+job+"/analysis-tasks","POST",{requestId:randomUUID()});
const status=id=>json(api+"/analysis-tasks/"+id);
const count=id=>Number(sql("SELECT COUNT(*) FROM "+schema+".analysis_versions WHERE task_id='"+id+"'"));
const published=id=>until(()=>status(id), t=>{assert.notEqual(t.state,"failed",t.reason); return t.state==="published";},"发布任务 "+id);
try {
  let primary=await start(m6Jar);
  const {id}=await json("/api/courses","POST",{name:"升级试用"+Date.now()});
  api="/api/courses/"+id;
  const pdf=await upload("material","讲义.pdf",await readFile(".local/m5-samples/讲义.pdf"));
  const exam=await upload("exam","甲卷.md","第1题 解释函数依赖。");
  const old=await batch([pdf,exam]);
  const baseline=await json(api+"/jobs/"+old+"/analysis","POST");
  const oldRef=Object.values(baseline.sources).find(s=>s.file===pdf);
  assert.ok(!oldRef.url.includes("artifact="));
  const digest=await bytes(oldRef.url);
  const positive=baseline.ranked.find(r=>r.count>0);
  await json(api+"/versions/"+baseline.version+"/states/"+positive.id,"PUT",{revision:0,note:"升级前笔记",completed:true});
  const exported=await bytes(api+"/versions/"+baseline.version+"/export");
  await stop(primary);
  primary=await start(r1Jar);
  const extra=await upload("material","补充.md","# 复习\n函数依赖：属性之间的决定关系。");
  const job=await batch([pdf,exam,extra]);
  const before=await json(api+"/jobs/"+job+"/analysis","POST");
  const r1Ref=Object.values(before.sources).find(s=>s.file===pdf);
  assert.ok(r1Ref.url.includes("artifact="));
  await stop(primary);
  primary=await start(r2Jar);
  assert.equal((await json(api+"/analysis")).version,before.version);
  assert.equal(await bytes(oldRef.url),digest);
  assert.equal(await bytes(api+"/versions/"+baseline.version+"/export"),exported);
  assert.equal((await json(api+"/versions/"+baseline.version+"/states"))[0].note,"升级前笔记");
  for (const [batchId,ref,expected] of [[old,oldRef,baseline],[job,r1Ref,before]]) {
    docker("stop","final-review-r2-broker-1"); brokerStopped=true;
    const t=await submit(batchId);
    const key=api+"/jobs/"+batchId+"/"+pdf;
    const r=await call(key+"/recheck","POST");
    assert.equal(r.status,200);
    await ready(batchId);
    const changed=(await json(key+"/segments"))[0];
    assert.notEqual(changed.url,ref.url);
    await stop(primary);
    primary=await start(r2Jar);
    assert.equal((await status(t.id)).state,"pending");
    docker("start","final-review-r2-broker-1"); brokerStopped=false;
    await published(t.id);
    const snap=await json(api+"/analysis");
    assert.equal(snap.paperCount,expected.paperCount);
    assert.deepEqual(snap.ranked,expected.ranked);
    assert.deepEqual(snap.sources,expected.sources);
    for (const source of Object.values(snap.sources))
      assert.equal((await fetch(base+source.url)).status,200);
    const frozen=Object.values(snap.sources).find(s=>s.file===pdf);
    assert.equal(frozen.url,ref.url);
    assert.equal(await bytes(frozen.url),digest);
    assert.equal(count(t.id),1);
    const fresh=await submit(batchId);
    await published(fresh.id);
    assert.equal(Object.values((await json(api+"/analysis")).sources).find(s=>s.file===pdf).url,changed.url);
    console.log("PASS frozen input and restart",t.id,ref.url.includes("artifact=")?"R1":"legacy");
  }
  const afterCommit=await breakpoint(18128,"if (lock.isHeldByCurrentThread()) lock.unlock()");
  const crashTask=await submit(job);
  assert.ok((await afterCommit.paused()).includes(crashTask.id));
  const committed=await status(crashTask.id);
  assert.equal(committed.state,"published");
  assert.equal(count(crashTask.id),1);
  const exited=once(primary,"exit"); afterCommit.crash(); await exited;
  docker("stop","final-review-r2-broker-1"); brokerStopped=true;
  primary=await start(r2Jar);
  const replay=await breakpoint(18128,"if (task == null || task.terminal())",crashTask.id);
  docker("start","final-review-r2-broker-1"); brokerStopped=false;
  assert.ok((await replay.paused()).includes(crashTask.id));
  replay.release();
  assert.deepEqual(await status(crashTask.id),committed);
  assert.equal(count(crashTask.id),1);
  console.log("PASS post-commit crash and actual redelivery",crashTask.id,committed.version);

  const stale=await breakpoint(18128,"analysis.tx.executeWithoutResult");
  const t=await submit(job);
  assert.ok((await stale.paused()).includes(t.id));
  docker("stop","final-review-r2-redis-1"); redisStopped=true;
  assert.equal((await status(t.id)).state,"running");
  assert.equal((await call(api,"DELETE")).status,409);
  const second=await start(r2Jar,18129);
  docker("start","final-review-r2-redis-1"); redisStopped=false;
  const winner=await published(t.id);
  assert.equal(winner.attempts,2);
  await stale.finish();
  assert.equal(count(t.id),1);
  assert.deepEqual(await status(t.id),winner);
  assert.equal((await json(api+"/analysis")).version,winner.version);
  await stop(second);
  console.log("PASS stale execution rejected after takeover",t.id,winner.attempts,winner.version);
} finally {
  for (const p of [...processes]) await stop(p);
  if (brokerStopped) docker("start","final-review-r2-broker-1");
  if (redisStopped) docker("start","final-review-r2-redis-1");
}
