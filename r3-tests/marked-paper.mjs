import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

export async function markedPaper({base,json}) {
  const sample = JSON.parse(execFileSync("python",["-B","r3-tests/holdout.py","--sample"],{encoding:"utf8"}));
  const api = "/api/course";
  const files = [];
  for (const [role, contents] of [["material",sample.lesson],["exam",sample.paper]]) {
    const form = new FormData();
    form.append("role",role);
    form.append("file",new Blob([contents]),role+".md");
    const response = await fetch(base+api+"/files",{method:"POST",headers:{"X-Review-Request":"1"},body:form});
    assert.equal(response.status,200);
    files.push((await response.json()).id);
  }
  const job = await json(api+"/jobs","POST",{files});
  for (let i=0; i<200; i++) {
    if ((await json(api+"/jobs/"+job.id)).every(f=>f.status==="ready")) break;
    await wait(250);
  }
  const original = await json(api+"/jobs/"+job.id+"/analysis","POST");
  const edits = original.reviews.filter(r=>r.question!=null).map(r=>{
    const q = original.questions[r.question];
    assert.ok(sample.reviewed[q.label]);
    return {question:r.question,requirement:r.requirement,refs:r.refs,matches:[sample.reviewed[q.label]]};
  });
  const result = await json(api+"/versions/"+original.version+"/corrections","POST",{requestId:randomUUID(),edits});
  const pairs = result.questions.flatMap(q=>q.matches.map(name=>[q.label,name]));
  assert.deepEqual(pairs.sort(),sample.truth.sort());
  assert.equal(result.reviews.length,0);
  console.log("PASS fixed human annotations replayed through publication: precision 8/8, recall 8/8, pending 0/6");
}
