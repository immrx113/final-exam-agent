import assert from "node:assert/strict";
import {setTimeout as wait} from "node:timers/promises";
const base = process.env.REVIEW_TEST_URL || "http://127.0.0.1:8080";
const headers = {"X-Review-Request":"1"};

async function request(path, options, origin=base) {
  const response = await fetch(origin+"/api/course/"+path,options);
  assert.equal(response.status,200,await response.clone().text());
  return response.json();
}
async function upload(name, role, text) {
  const body = new FormData();
  body.append("file",new Blob([text]),name);
  body.append("role",role);
  return (await request("files",{method:"POST",headers,body})).id;
}
async function publish(files) {
  const {id} = await request("jobs",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({files})});
  for(let i=0;i<120;i++) {
    const items=await request("jobs/"+id);
    if(items.every(item=>item.status==="ready")) return request("jobs/"+id+"/analysis",{method:"POST",headers});
    assert.ok(!items.some(item=>item.status==="failed"));
    await wait(500);
  }
  throw Error("Parse timeout");
}
const lecture=await upload("边界讲义.md","material","# 设计理论\n外键：引用另一关系键值的属性。\n函数依赖：属性之间的决定关系。");
const empty=await publish([lecture]);
assert.equal(empty.paperCount,0);
assert.equal(empty.ranked.length,2);
const test=await upload("附加样卷.md","exam","第1题 不考查函数依赖，请判断外码约束。\n第2题 什么是两阶段锁协议？\n第3题 判断外键\n是否允许此项更新。\n第4题 此题关联未知。");
const full=await publish([lecture,test]);
assert.equal(full.paperCount,1);
const rows=Object.fromEntries(full.ranked.map(r=>[r.topic.name,r]));
assert.deepEqual([rows["函数依赖"].count,rows["外键"].count,rows["两阶段锁协议"].count],[0,2,1]);
assert.equal(rows["两阶段锁协议"].topic.chapter,"待归类");
assert.equal(rows["外键"].id,empty.ranked.find(r=>r.topic.name==="外键").id);
assert.equal(rows["外键"].questions[1].refs.length,2);
assert.equal(full.reviews.length,1);
const faultBase=process.env.REVIEW_FAULT_URL;
if(faultBase) {
  for (const [name,status] of [["越界",502],["超时",504]]) {
    const file=await upload(name+".md","exam",name+"\n第1题 判断外键。");
    const {id}=await request("jobs",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({files:[file]})});
    for(let i=0;i<100;i++) {
      if((await request("jobs/"+id))[0].status==="ready") break;
      await wait(300);
    }
    const pending=fetch(faultBase+"/api/course/jobs/"+id+"/analysis",{method:"POST",headers});
    if (status===504) {
      await wait(250);
      assert.deepEqual(await request("analysis"),full);
    }
    const response=await pending;
    assert.equal(response.status,status);
    assert.deepEqual(await request("analysis"),full);
  }
}
console.log("PASS M2-03,06,07,08: no paper, zero hits, incidental mention, alias, independent exam topic, continued question, uncertain match, stable IDs" + (faultBase?", invalid reference, timeout, previous publication":""));
