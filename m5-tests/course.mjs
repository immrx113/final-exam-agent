import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const base = "http://127.0.0.1:18085";
const sample = name => fileURLToPath(new URL("../.local/m5-samples/" + name, import.meta.url));
// Independently annotated question number and original location in each paper.
const truth = {
  函数依赖: [1, 2, 3, 4].map(n => `甲卷.md/${n}/第 ${n+1} 行`),
  关系代数: ["甲卷.md/5/第 6 行", "乙卷.pdf/1/原文第 1 页", "丙卷.pdf/1/原文第 1 页"],
};
const browser = await chromium.launch({channel: "msedge"});
try {
  const page = await browser.newPage();
  await page.goto(base);
  async function publish(duplicate) {
    await page.getByLabel("选择课件", {exact:true}).setInputFiles(sample("lesson.pptx"));
    await page.getByLabel("选择资料", {exact:true}).setInputFiles(sample("讲义.pdf"));
    const names = ["甲卷.md", "乙卷.pdf", "丙卷.pdf", "散页.png"];
    const files = await Promise.all(names.map(async name => ({name, mimeType:"application/octet-stream", buffer:await readFile(sample(name))})));
    if (duplicate) files.push({...files[0], name:"重传甲卷.md"});
    await page.getByLabel("选择试卷", {exact:true}).setInputFiles(files);
    const start = performance.now();
    const [batch] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/jobs") && r.request().method()==="POST"),
      page.getByRole("button", {name:"提交处理"}).click(),
    ]);
    const {id} = await batch.json();
    await page.waitForFunction(id => document.querySelector('[aria-label="处理批次"]')?.value === id, id);
    const button = page.getByRole("button", {name:"分析本批资料"});
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent==="分析本批资料" && !b.disabled), null, {timeout:240000});
    const parsed = performance.now();
    const items = await (await page.request.get(base+"/api/course/jobs/"+id)).json();
    assert.ok(items.every(i => i.status === "ready"), JSON.stringify(items.map(i=>[i.name,i.status])));
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/jobs/"+id+"/analysis"), {timeout:150000}),
      button.click(),
    ]);
    assert.equal(response.status(), 200);
    const result = await response.json();
    console.log("导入解析 / 分析 ms", Math.round(parsed-start), Math.round(performance.now()-parsed));
    return result;
  }
  async function verify(result) {
    assert.equal(result.paperCount,3);
    const positive = result.ranked.filter(r=>r.count>0);
    assert.deepEqual(positive.map(r=>[r.topic.name,r.count,r.papers]), [["函数依赖",4,1],["关系代数",3,3]]);
    const locations = ids => ids.map(id=>result.sources[id]);
    const teaching = locations(positive[0].topic.refs);
    assert.deepEqual(teaching.map(s=>s.name+"/"+s.label).sort(), ["lesson.pptx/转换预览第 2 页","讲义.pdf/原文第 1 页"].sort());
    const open = async source => assert.equal((await page.request.get(base+source.url)).status(),200);
    for (const s of teaching) await open(s);
    for (const row of positive) {
      const found = [];
      for (const q of row.questions) for (const s of locations(q.refs)) {
        found.push(s.name.replace("重传","")+"/"+q.label+"/"+s.label);
        await open(s);
      }
      assert.deepEqual(found.sort(), [...truth[row.topic.name]].sort());
    }
    const review = result.reviews.flatMap(r=>locations(r.refs));
    assert.ok(review.some(s=>s.name==="散页.png"));
    for (const s of review) await open(s);
    return positive;
  }
  await verify(await publish(false));
  const result = await publish(true);
  const rows = await verify(result);
  assert.deepEqual(await page.locator(".topic summary strong").allTextContents(), Object.keys(truth));
  const algebra = page.locator(".topic").filter({has:page.getByText("关系代数",{exact:true})});
  await algebra.locator("summary").click();
  const [scan] = await Promise.all([page.waitForEvent("popup"),algebra.getByRole("link",{name:"丙卷.pdf · 原文第 1 页"}).click()]);
  await scan.waitForFunction(()=>document.images[0]?.naturalWidth>0);
  await scan.close();
  await page.getByRole("tab", { name: /^参考计划/ }).click();
  assert.ok((await page.locator("ol li").first().innerText()).includes(result.plan[0].reason));
  await page.getByRole("tab", { name: /^复习待办/ }).click();
  const item = page.locator(".study-item").filter({has:page.getByLabel("学习笔记 · 函数依赖",{exact:true})});
  const saved = async action => {
    const [r] = await Promise.all([page.waitForResponse(r=>r.request().method()==="PUT"),action()]);
    assert.equal(r.status(),200);
  };
  if (!(await item.getByRole("checkbox").isChecked())) await saved(()=>item.getByRole("checkbox").click());
  const note = "逐题核对决定属性 " + result.version;
  await item.locator("textarea").fill(note);
  await saved(()=>item.getByRole("button",{name:"保存笔记"}).click());
  await page.reload();
  await page.getByRole("tab", { name: /^复习待办/ }).click();
  assert.equal(await item.locator("textarea").inputValue(),note);
  assert.ok(await item.getByRole("checkbox").isChecked());
  const [download] = await Promise.all([page.waitForEvent("download"),page.getByText("下载 Markdown 复习文档").click()]);
  const md = await readFile(await download.path(),"utf8");
  assert.ok(md.includes(result.version) && !md.includes(note));
  assert.deepEqual(md.match(/^### .+$/gm)?.sort(), ["### 函数依赖","### 关系代数"].sort());
  for (const row of rows) {
    assert.ok(md.includes(`命中 ${row.count} 题，覆盖 ${row.papers}/3 份卷`));
    for (const q of row.questions) for (const id of q.refs) {
      const s = result.sources[id];
      assert.ok(md.includes(`第 ${q.label} 题：${s.name} · ${s.label}`));
    }
  }
  console.log("PASS M5 混合格式、原页、重复卷、笔记与实际下载");
} finally { await browser.close(); }
