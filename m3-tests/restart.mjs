// Run prepare, restart the dedicated Java process, then run verify.
import assert from "node:assert/strict";
const base = process.env.REVIEW_TEST_URL;
const mode = process.argv[2];
if (!base || !["prepare","verify"].includes(mode)) throw Error("需要专用 REVIEW_TEST_URL 和 prepare 或 verify");
const latest = async () => (await fetch(base+"/api/course/analysis")).json();
const result = await latest();
const root = base+"/api/course/versions/"+result.version;
const topic = result.ranked.find(r=>r.count>0).id;
const note = "重启验收 " + result.version;
const states = async () => (await (await fetch(root+"/states")).json()).find(s=>s.topic===topic);
if (mode==="prepare") {
  const prior = await states();
  const save = await fetch(root+"/states/"+topic,{method:"PUT",headers:{"Content-Type":"application/json","X-Review-Request":"1"},
    body:JSON.stringify({revision:prior?.revision ?? 0, completed:true, note})});
  assert.equal(save.status,200);
}
const state=await states();
assert.equal(state.note,note);
assert.equal(state.completed,true);
if (mode==="verify" && process.env.REVIEW_FAULT_URL) {
  const md=await (await fetch(root+"/export")).text();
  const fail=fetch(process.env.REVIEW_FAULT_URL+"/api/course/jobs/"+result.job+"/analysis",{method:"POST",headers:{"X-Review-Request":"1"}});
  assert.equal(await (await fetch(root+"/export")).text(),md);
  assert.equal((await fail).status,502);
  assert.equal((await latest()).version,result.version);
  assert.deepEqual(await states(),state);
  assert.equal(await (await fetch(root+"/export")).text(),md);
}
console.log("PASS",mode,"published version, note and completion",mode==="verify" && process.env.REVIEW_FAULT_URL ? "including failed analysis" : "");
