import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";

const {chromium} = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const base = process.env.REVIEW_TEST_URL;
if (!base) throw Error("请设置 REVIEW_TEST_URL 指向专用测试课程。");
const browser = await chromium.launch({channel: "msedge", headless: true});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/course/analysis",route=>route.fulfill({body:"null",contentType:"application/json"}),{times:1});
  await page.goto(base);
  if ((await (await page.request.get(base+"/api/course/jobs")).json()).length)
    await page.getByText("请先分析本批资料，生成复习计划和待办。").waitFor();
  const lecture = "# 关系数据理论\n候选键：能够唯一标识元组的最小属性集合。\n第三范式：用于减少关系模式中的传递依赖。\n死锁：事务之间相互等待对方持有的资源。";
  const order = "\n先求候选键，再判断第三范式。";
  const paper = "第1题 判断第三范式。\n第2题 解释第三范式。\n第3题 求候选键。";
  function file(name, body) {
    return {name, mimeType:"text/markdown", buffer:Buffer.from(body)};
  }
  async function publish(text, exam) {
    await page.getByLabel("选择资料",{exact:true}).setInputFiles(file("M3讲义.md",text));
    if (exam) await page.getByLabel("选择试卷",{exact:true}).setInputFiles(Array.isArray(exam) ? exam : file("M3样卷.md",exam));
    const [jobResponse] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/jobs") && r.request().method()==="POST"),
      page.getByRole("button",{name:"提交处理"}).click()
    ]);
    const {id} = await jobResponse.json();
    await page.waitForFunction(id => document.querySelector('[aria-label="处理批次"]')?.value===id,id);
    const [response] = await Promise.all([
      page.waitForResponse(r=>r.url().endsWith("/jobs/"+id+"/analysis") && r.request().method()==="POST"),
      page.getByRole("button",{name:"分析本批资料"}).click()
    ]);
    assert.equal(response.status(),200,await response.text());
    return response.json();
  }
  const view = (p,name) => p.getByLabel("查看方式").selectOption(name);
  const item = p => p.locator(".study-item").filter({has:p.getByLabel("学习笔记 · 候选键",{exact:true})});
  const saved = async (p,action,code=200) => {
    const [response] = await Promise.all([p.waitForResponse(r=>r.request().method()==="PUT"),action()]);
    assert.equal(response.status(),code,await response.text());
  };
  async function write(p, note, status=200) {
    await item(p).locator("textarea").fill(note);
    await saved(p,()=>item(p).getByRole("button",{name:"保存笔记"}).click(),status);
  }

  const initial = await publish(lecture+order,paper);
  assert.equal(initial.paperCount,1);
  await view(page,"plan");
  const plan = page.getByRole("region",{name:"课程分析"}).locator("ol > li");
  assert.match(await plan.first().innerText(),/候选键.*第三范式/);
  assert.match(await plan.first().locator("a").innerText(),/M3讲义/);
  await view(page,"study");
  assert.match(await page.locator(".study-item summary").first().innerText(),/第三范式.*2 题/);
  assert.equal(await page.locator(".study-item").count(),2);
  const check = item(page).getByRole("checkbox");
  await saved(page,()=>check.click());
  const note = "先求候选键，再判断范式 " + Date.now();
  await write(page,note);
  await saved(page,()=>check.click());
  await page.reload();
  await view(page,"study");
  assert.equal(await item(page).locator("textarea").inputValue(),note);
  const peer = await browser.newPage();
  await peer.goto(base);
  await view(peer,"study");
  assert.equal(await item(peer).locator("textarea").inputValue(),note);
  await write(page,note+" A");
  await write(peer,note+" B",409);
  await item(peer).getByText(/其他页面已更新/).waitFor();
  assert.equal(await item(peer).locator("textarea").inputValue(),note+" B");
  assert.match(await item(peer).innerText(),new RegExp(note+" A"));
  await peer.close();

  await page.route("**/states/*",route=>route.abort(),{times:1});
  await item(page).locator("textarea").fill(note+" 重试");
  await item(page).getByRole("button",{name:"保存笔记"}).click();
  await item(page).getByText(/保存失败/).waitFor();
  await saved(page,()=>item(page).getByRole("button",{name:"保存笔记"}).click());
  const [download] = await Promise.all([page.waitForEvent("download"),page.getByText("下载 Markdown 复习文档").click()]);
  assert.match(download.suggestedFilename(),/\.md$/);
  const content = await readFile(await download.path(),"utf8");
  assert.ok(content.includes(initial.version));
  assert.deepEqual(content.match(/^### .*$/gm)?.sort(),["### 候选键","### 第三范式"].sort());
  assert.doesNotMatch(content,/死锁|重试|已完成/);
  for (const row of initial.ranked.filter(r=>r.count>0)) {
    assert.ok(content.includes(row.id));
    assert.ok(content.includes("命中 "+row.count+" 题，覆盖 "+row.papers+"/1 份卷"));
    for (const q of row.questions) for (const id of q.refs) {
      const ref=initial.sources[id];
      assert.ok(content.includes("第 "+q.label+" 题："+ref.name+" · "+ref.label));
    }
  }
  const exportUrl = result => base+"/api/course/versions/"+result.version+"/export";
  const changed = await publish(lecture,paper+"\n第4题 解释候选键。\n第5题 写出候选键。");
  assert.equal(changed.plan[0].topic,changed.ranked[0].id);
  await view(page,"study");
  assert.match(await page.locator(".study-item summary").first().innerText(),/候选键/);
  assert.equal(await item(page).locator("textarea").inputValue(),note+" 重试");
  assert.equal(await (await page.request.get(exportUrl(initial))).text(),content);
  const hidden = await publish(lecture,"第1题 解释第三范式。");
  assert.ok(!hidden.plan.some(s=>s.topic===changed.ranked[0].id));
  const cycle = await publish(lecture+order+"\n先学习第三范式，再学习候选键。",paper);
  assert.deepEqual(cycle.plan.map(s=>s.topic),cycle.ranked.filter(r=>r.count>0).map(r=>r.id));
  await view(page,"study");
  assert.equal(await item(page).locator("textarea").inputValue(),note+" 重试");
  await write(page,"");
  await page.reload();
  await view(page,"study");
  assert.equal(await item(page).locator("textarea").inputValue(),"");
  const noPapers = await publish(lecture);
  assert.equal(noPapers.paperCount,0);
  await page.getByText("暂无有效试卷可供导出").waitFor();
  const zero = await publish(lecture,"第1题 请简述上述现象。");
  assert.equal(zero.paperCount,1);
  await page.getByText("暂无已确认命中的知识点可导出").waitFor();
  for (const snap of [noPapers,zero]) {
    const response = await page.request.get(exportUrl(snap));
    assert.equal(response.status(),204);
    assert.equal(response.headers()["content-disposition"],undefined);
  }
  // M3-01 and M3-06: compare a three-paper export with the annotated M2 sample.
  const fixture = name => readFile(new URL("../m2-tests/fixtures/"+name+".md",import.meta.url),"utf8");
  const papers = await Promise.all(["甲卷","乙卷","丙卷"].map(async name=>file(name+".md",await fixture(name))));
  const three = await publish(await fixture("课件")+"\n死锁：事务之间互相等待对方持有的资源。",papers);
  await view(page,"study");
  await page.locator(".study-item").first().waitFor();
  assert.match(await page.locator(".study-item summary").nth(0).innerText(),/函数依赖.*4 题 · 1\/3/);
  assert.match(await page.locator(".study-item summary").nth(1).innerText(),/关系代数.*3 题 · 3\/3/);
  const md = await (await page.request.get(exportUrl(three))).text();
  assert.match(md,/命中 4 题，覆盖 1\/3/);
  assert.match(md,/命中 3 题，覆盖 3\/3/);
  assert.doesNotMatch(md,/### 死锁/);
  assert.deepEqual(errors,[]);
  console.log("PASS M3 course flow, prerequisites and cycle fallback, persistence, conflict/retry, versioned Markdown, empty exports");
} finally { await browser.close(); }
