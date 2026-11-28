import { waitForPublication } from "../r2-tests/publication.mjs";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {setTimeout as delay} from "node:timers/promises";

const {chromium}=createRequire(new URL("../web/package.json",import.meta.url))("playwright-core");
const base=process.env.REVIEW_TEST_URL;
if (!base) throw Error("请设置 REVIEW_TEST_URL 指向专用测试课程");
const live=process.argv.includes("--live");
let mode="failure", searches=0;
let releaseSearch;
const queries=[];
const fixture=createServer(async (req,res)=>{
  const url=new URL(req.url,"http://localhost");
  let data;
  if (url.pathname.endsWith("/type")) {
    searches++;
    queries.push(url.searchParams.get("keyword"));
    if (mode==="failure") { await delay(1800); res.writeHead(412).end(); return; }
    if (mode==="delayed") await new Promise(resolve=>{releaseSearch=resolve;});
    data={result:mode==="empty" ? [] : [{bvid:"BV1234567890",title:"数据库原理"}, {bvid:"BV9999999999",title:"足球赛事"}]};
  } else {
    if (mode==="failure") {res.writeHead(503).end(); return;}
    if (mode==="directory") {res.writeHead(503).end(); return;}
    data=url.searchParams.get("bvid")==="BV9999999999" ? {title:"足球赛事",stat:{view:1000000}} :
      {title:"数据库原理",stat:{view:0,like:2},pages:[{page:1,part:"简介"},{page:2,part:"关系代数与候选键"}]};
  }
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify({code:0,data}));
});
if (!live) await new Promise(resolve=>fixture.listen(18442,"127.0.0.1",resolve));
let browser;
try {
  browser=await chromium.launch({channel:"msedge",headless:true});
  const page=await browser.newPage();
  await page.goto(base);
  async function publish(lesson,exam) {
    const file=(name,text)=>({name,mimeType:"text/markdown",buffer:Buffer.from(text)});
    await page.getByLabel("选择资料",{exact:true}).setInputFiles(file("M4讲义.md",lesson));
    if(exam) await page.getByLabel("选择试卷",{exact:true}).setInputFiles(file("M4样卷.md",exam));
    const [job]=await Promise.all([page.waitForResponse(r=>r.url().endsWith("/jobs") && r.request().method()==="POST"),page.getByRole("button",{name:"提交处理"}).click()]);
    const id=(await job.json()).id;
    await page.waitForFunction(id=>document.querySelector('[aria-label="处理批次"]')?.value===id,id);
    const [analysis]=await Promise.all([waitForPublication(page),page.getByRole("button",{name:"分析本批资料"}).click()]);
    assert.equal(analysis.status(),200);
    return (await analysis.json()).version;
  }
  const lesson="# 数据库基础\n关系代数：用于表达关系查询的运算体系。\n候选键：能够唯一标识元组的最小属性集合。";
  const version=live && process.argv.includes("--current")
    ? (await (await page.request.get(base+"/api/course/analysis")).json()).version
    : await publish(lesson,"第1题 解释关系代数。");
  const video=page.getByRole("region",{name:"B 站参考视频"});
  if(live) {
    const link=video.getByRole("link").first();
    await link.waitFor({timeout:120000});
    const [tab]=await Promise.all([page.waitForEvent("popup"),link.click()]);
    await tab.waitForURL(/^https:\/\/www\.bilibili\.com\/video\/BV/,{waitUntil:"domcontentloaded"});
    await tab.waitForFunction(()=>/数据库|关系代数/.test(document.title));
    console.log("真实检索结果",await video.innerText(),tab.url(),await tab.title());
  } else {
    await video.getByText("正在检索参考视频…").waitFor();
    await page.getByRole("tab", { name: /^章节目录/ }).click();
    await page.getByText("关系代数",{exact:true}).first().waitFor();
    await page.getByRole("tab", { name: /^复习待办/ }).click();
    const check=page.locator(".study-item input[type=checkbox]").first();
    await check.click();
    const note=page.getByLabel("学习笔记 · 关系代数",{exact:true});
    const noteText="视频故障期间的复习笔记 "+Date.now();
    await note.fill(noteText);
    const [saved]=await Promise.all([page.waitForResponse(r=>r.request().method()==="PUT"),page.getByRole("button",{name:"保存笔记"}).click()]);
    assert.equal(saved.status(),200);
    await video.getByText(/HTTP 412/).waitFor();
    const [download]=await Promise.all([page.waitForEvent("download"),page.getByText("下载 Markdown 复习文档").click()]);
    assert.match(download.suggestedFilename(),/\.md$/);
    const before=searches;
    await page.reload();
    await page.getByRole("tab", { name: /^复习待办/ }).click();
    await video.getByText(/HTTP 412/).waitFor();
    assert.equal(await note.inputValue(),noteText);
    assert.equal(searches,before);
    mode="success";
    const retry=page.request.post(base+"/api/course/versions/"+version+"/videos/retry",{headers:{"X-Review-Request":"1"}});
    await video.getByRole("button",{name:"重试视频检索"}).click();
    assert.equal((await retry).status(),200);
    await video.getByText(/整条视频 · 播放 0 · 点赞 2 · 收藏 未取得/).waitFor();
    assert.equal(searches,before+1);
    assert.match(await video.getByRole("link").getAttribute("href"),/\?p=2$/);
    assert.ok(queries.every(q=>q==="数据库原理 关系代数"));
    await publish(lesson);
    await video.getByText(/对应知识点：.*候选键/).waitFor();
    assert.equal(await video.getByRole("link").count(),1);
    mode="directory";
    await publish(lesson);
    await video.getByText(/整套课程/).waitFor();
    assert.equal(await video.getByRole("link").count(),1);
    mode="delayed";
    const delayed=await publish(lesson,"第1题 解释关系代数。");
    for(let n=0;n<60 && !releaseSearch;n++) await delay(100);
    assert.ok(releaseSearch);
    mode="empty";
    await publish("# 事务\n死锁：事务之间相互等待持有的资源。");
    mode="success";
    releaseSearch();
    // Both versions may now read the same candidates, but only the old topics match.
    await video.getByText("暂无匹配视频").waitFor();
    const late=await (await page.request.get(base+"/api/course/versions/"+delayed+"/videos")).json();
    assert.deepEqual(late.items[0].topics,["关系代数"]);
    const previous=await (await page.request.get(base+"/api/course/versions/"+version+"/videos")).json();
    assert.deepEqual(previous.items[0].topics,["关系代数"]);
    await publish(lesson,"第1题 描述无关内容。");
    await video.getByText("暂无可推荐的知识点").waitFor();
    console.log("M4 课程页、故障恢复、刷新、重复重试及版本隔离通过");
  }
} finally {
  await browser?.close();
  fixture.close();
}
