import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const base = process.env.REVIEW_TEST_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(base);
  const fixture = name => fileURLToPath(new URL("./fixtures/" + name + ".md", import.meta.url));
  await page.getByLabel("选择课件", {exact:true}).setInputFiles(fixture("课件"));
  await page.getByLabel("选择资料", {exact:true}).setInputFiles(fixture("讲义"));
  const papers = await Promise.all(["甲卷","乙卷","丙卷","甲卷"].map(async (name, i) =>
    ({name: (i===3 ? "重传甲卷" : name) + ".md", mimeType:"text/markdown", buffer:await readFile(fixture(name))})));
  await page.getByLabel("选择试卷", {exact:true}).setInputFiles(papers);
  await page.getByRole("button", {name:"提交处理"}).click();
  const analyze = page.getByRole("button", {name:"分析本批资料"});
  async function run() {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method()==="POST" && r.url().endsWith("/analysis"), {timeout:150000}),
      analyze.click({timeout:90000})
    ]);
    assert.equal(response.status(),200,await response.text());
    return response.json();
  }
  const first = await run();
  assert.deepEqual(first.ranked.map(r=>[r.topic.name,r.count,r.papers]),[
    ["函数依赖",4,1],["关系代数",3,3],["候选键",1,1]]);
  assert.equal(first.paperCount,3);
  const fd = page.locator(".topic").first();
  await fd.locator("summary").click();
  assert.match(await fd.locator("summary").innerText(), /4 题 · 1\/3 份卷/);
  assert.equal(await fd.locator("li").count(),4);
  assert.equal(first.ranked[0].topic.refs.length,2);
  const expected = {
    "函数依赖": ["甲卷.md/1/L2","甲卷.md/2/L3","甲卷.md/3(1)/L4,L5","甲卷.md/3(2)/L4,L6"],
    "关系代数": ["甲卷.md/4/L7","乙卷.md/1/L2","丙卷.md/1/L2"],
    "候选键": ["甲卷.md/3(2)/L4,L6"],
  };
  assert.deepEqual(first.ranked[0].topic.refs.map(id=>first.sources[id].name).sort(),["课件.md","讲义.md"].sort());
  for (const row of first.ranked) {
    const observed = row.questions.map(q => {
      const sources = q.refs.map(id=>first.sources[id]);
      return sources[0].name.replace("重传","") + "/" + q.label + "/" + sources.map(s=>s.url.split("#")[1]).join(",");
    });
    assert.deepEqual(observed.sort(),expected[row.topic.name].sort());
    for (const q of row.questions) for (const ref of q.refs) {
      const url = first.sources[ref].url;
      const origin = await page.request.get(base + url);
      assert.equal(origin.status(),200);
      assert.ok((await origin.text()).includes("id=" + url.split("#")[1] + ">"));
    }
  }
  const popup = page.waitForEvent("popup");
  await fd.locator("li a").first().click();
  const original = await popup;
  await original.waitForLoadState();
  assert.match(await original.locator(":target").innerText(), /函数依赖/);
  await original.close();
  await page.getByRole("tab", { name: /^章节目录/ }).click();
  await page.getByRole("heading",{name:"关系数据理论"}).waitFor();
  const again = await run();
  assert.deepEqual(again.ranked,first.ranked);
  await page.reload();
  await page.getByText("函数依赖",{exact:true}).first().waitFor();
  assert.deepEqual(errors,[]);
  console.log("PASS M2-01..05,08: browser import, ranking, chapter, source locations, duplicate, same-batch retry, reload");
} finally {
  await browser.close();
}
