import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { waitForPublication } from "../r2-tests/publication.mjs";

const {chromium} = createRequire(new URL("../web/package.json",import.meta.url))("playwright-core");
const file = (name, text) => ({name, mimeType:"text/markdown", buffer:Buffer.from(text)});
const row = (snap, name) => snap.ranked.find(r => r.topic.name === name);
const stats = (snap, name) => [row(snap,name).count,row(snap,name).papers,snap.paperCount];

export async function exercise({base, call, json, failId, restart}) {
  const {id} = await json("/api/courses","POST",{name:"订单练习"});
  const api = "/api/courses/" + id;
  const versions = api + "/versions";
  const browser = await chromium.launch({channel:"msedge",headless:true});
  const errors = [];
  async function workspace() {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(id => sessionStorage.setItem("selected-course",id),id);
    await page.goto(base);
    return page;
  }
  try {
    const page = await workspace();
    await page.getByLabel("选择资料",{exact:true}).setInputFiles(file("讲义.md", "# 关系模型\n主键：唯一标识表中每行的属性组合。\n外键：引用其他表键值以保持一致性的属性。\nR2_SLOW"));
    await page.getByLabel("选择试卷",{exact:true}).setInputFiles(file("订单卷.md","第1题 指出订单表的主键，并说明为什么订单中的客户编号必须在客户表中存在。"));
    await page.getByRole("button",{name:"提交处理"}).click();
    const [published] = await Promise.all([waitForPublication(page), page.getByRole("button",{name:"分析本批资料"}).click()]);
    const orig = await published.json();
    assert.deepEqual(stats(orig,"主键"),[1,1,1]);
    assert.deepEqual(stats(orig,"外键"),[0,0,1]);
    const reqs = orig.questions[0].requirements;
    assert.equal(reqs.length,2);
    assert.deepEqual(reqs[1].candidates,["外键"]);
    assert.deepEqual(orig.reviews.map(r=>[r.question,r.requirement]),[[0,1]]);
    const oldExport = await (await call(versions + "/" + orig.version + "/export")).text();
    const ref = orig.sources[reqs[1].refs[0]];
    assert.match(ref.url, /#L1$/);
    const originalPage = await (await fetch(base + ref.url)).text();
    assert.ok(originalPage.includes("客户编号"));
    const alternate = await workspace();
    async function edit(p) {
      await p.locator(".reviews-box summary").click();
      await p.getByRole("button",{name:"核对这一要求"}).click();
      await p.locator("#requirement-1").getByRole("checkbox",{name:/外键/}).check();
    }
    await edit(page);
    await page.getByRole("button",{name:"放弃本次修改"}).click();
    assert.equal(await page.getByRole("button",{name:"确认并发布修正版"}).count(),0);
    await page.locator("#requirement-1").getByRole("checkbox",{name:/外键/}).check();
    await edit(alternate);
    let submitted;
    await page.route("**/corrections",async route => {
      submitted = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(),200);
      await route.abort();
    },{times:1});
    await page.getByRole("button",{name:"确认并发布修正版"}).click();
    await page.getByText(/发布尚未确认/).waitFor();
    await page.getByRole("button",{name:"确认并发布修正版"}).click();
    await page.getByText(/本版修正记录/).waitFor();
    const child = await json(api + "/analysis");
    assert.equal((await json(versions)).length,2);
    assert.deepEqual(stats(child,"外键"),[1,1,1]);
    assert.deepEqual(child.correction.changes[0].before,[]);
    assert.equal(child.reviews.length,0);
    const send = (s, edits, requestId=randomUUID()) => call(versions + "/" + s.version + "/corrections","POST",{requestId,edits});
    const editRow = (s, ri, matches) => ({question:0, requirement:ri, refs:s.questions[0].requirements[ri].refs,matches});
    assert.equal((await send(orig,[editRow(orig,1,[])],submitted.requestId)).status,409);
    await alternate.getByRole("button",{name:"确认并发布修正版"}).click();
    await alternate.getByRole("button",{name:"查看最新版本"}).waitFor();
    assert.equal(await alternate.locator("#requirement-1 input:checked").count(),1);
    await page.getByLabel("阅读版本").selectOption(orig.version);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link",{name:/下载 Markdown/}).click();
    assert.equal(await readFile(await (await downloadPromise).path(),"utf8"),oldExport);
    await page.getByLabel("阅读版本").selectOption(child.version);
    const childDownload = page.waitForEvent("download");
    await page.getByRole("link",{name:/下载 Markdown/}).click();
    assert.match(await readFile(await (await childDownload).path(),"utf8"),/### 外键/);
    const fk = row(child,"外键").id;
    await json(versions + "/" + child.version + "/states/" + fk,"PUT",{revision:0,note:"核对引用关系",completed:true});
    const changed = [editRow(child,0,["主键","外键"])];
    assert.equal((await send(child,changed,failId)).status,500);
    assert.equal((await json(versions)).length,2);
    assert.equal((await send(child,[{...changed[0],refs:["another-question"]}])).status,400);
    assert.equal((await send(child,[editRow(child,1,["其他课程考点"])] )).status,400);
    assert.equal((await call("/api/course/versions/"+child.version)).status,404);
    assert.equal((await call("/api/course/versions/"+child.version+"/corrections","POST",submitted)).status,404);
    async function revise(s, edits) {
      const r = await send(s,edits);
      assert.equal(r.status,200);
      return r.json();
    }
    const twice = await revise(child, changed);
    assert.deepEqual(stats(twice,"外键"),[1,1,1]);
    const once = await revise(twice,[editRow(twice,1,[])]);
    assert.deepEqual(stats(once,"外键"),[1,1,1]);
    const hidden = await revise(once,[editRow(once,0,["主键"])]);
    assert.deepEqual(stats(hidden,"外键"),[0,0,1]);
    assert.ok(!hidden.plan.some(step=>step.topic===fk));
    assert.deepEqual(await json(versions + "/" + hidden.version + "/states"),[]);
    assert.ok(!(await (await call(versions + "/" + hidden.version + "/export")).text()).includes("### 外键"));
    const restored = await revise(hidden,[editRow(hidden,1,["外键"])]);
    assert.ok(restored.plan.some(step=>step.topic===fk));
    await restart();
    assert.deepEqual(await json(versions + "/" + child.version),child);
    const [state] = await json(versions + "/" + restored.version + "/states");
    assert.equal(state.note,"核对引用关系");
    assert.equal(state.completed,true);
    assert.equal(await (await call(versions + "/" + orig.version + "/export")).text(),oldExport);
    assert.equal(await (await fetch(base + ref.url)).text(), originalPage);
    const key = {requestId:randomUUID()};
    const path = api + "/jobs/" + orig.job + "/analysis-tasks";
    const active = await json(path,"POST",key);
    assert.equal((await json(path,"POST",key)).id,active.id);
    assert.equal((await send(restored,[editRow(restored,1,[])])).status,409);
    let terminal;
    for (let i=0; i<300; i++) {
      terminal = await json(api+"/analysis-tasks/"+active.id);
      if (["published","failed"].includes(terminal.state)) break;
      await wait(250);
    }
    assert.equal(terminal.state,"published");
    assert.deepEqual(stats(await json(api+"/analysis"),"外键"),[0,0,1]);
    const form = new FormData();
    form.append("role","exam");
    form.append("file",new Blob(["第1题 解释外键。"]),"甲卷.md");
    assert.ok((await fetch(base+api+"/files",{method:"POST",headers:{"X-Review-Request":"1"},body:form})).ok);
    const files = await json(api+"/files");
    const job = await json(api+"/jobs","POST",{files:files.map(f=>f.id)});
    for (let i=0; i<200; i++) {
      if ((await json(api+"/jobs/"+job.id)).every(f=>f.status==="ready")) break;
      await wait(250);
    }
    const pair = await json(api+"/jobs/"+job.id+"/analysis","POST");
    assert.deepEqual(stats(pair,"外键"),[1,1,2]);
    const qi = pair.questions.findIndex(q=>q.requirements.length===2);
    const combined = await revise(pair,[{question:qi,requirement:1,refs:pair.questions[qi].requirements[1].refs,matches:["外键"]}]);
    assert.deepEqual(stats(combined,"外键"),[2,2,2]);
    assert.match(await (await call(versions+"/"+combined.version+"/export")).text(),/覆盖 2\/2 份卷/);
    assert.equal(await (await fetch(base + ref.url)).text(), originalPage);
    console.log("PASS independent reanalysis, second-paper coverage 1/2 -> 2/2, historical source");
    console.log("PASS R3 browser correction, cancellation, lost response, two tabs, history, downloads, deduplication, rollback, restart, isolation and R2 interlock");
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
}
