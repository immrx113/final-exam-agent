// Prepare, restart the dedicated Java service, then verify against its saved versions.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.REVIEW_TEST_URL;
if (!["http://127.0.0.1:18085", "http://127.0.0.1:18087"].includes(base)) {
  throw Error("REVIEW_TEST_URL 须指向 18085 或 18087 独立试用实例");
}
const mode = process.argv[2];
assert.ok(["prepare", "verify"].includes(mode), "使用 prepare 或 verify");
const stateFile = ".local/m6-checkpoint-" + new URL(base).port + ".json";
const { chromium } = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const browser = await chromium.launch({channel:"msedge", headless:true});
const page = await browser.newPage();
const legacy = "/api/course";
const jsonHeaders = {"Content-Type":"application/json","X-Review-Request":"1"};
const title = page.getByRole("heading", {level:1});
const selector = page.getByLabel("当前课程", {exact:true});
const notes = page.getByLabel("学习笔记 · 死锁", {exact:true});
const deadlock = page.locator(".study-item").filter({has:notes});
let empty = false;
const queries = [];
const fixture = createServer((req,res) => {
  const url = new URL(req.url, base);
  if (url.pathname.endsWith("/type")) queries.push(url.searchParams.get("keyword"));
  if (!empty) return res.writeHead(412).end();
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify({code:0,data:{result:[]}}));
});

async function get(path) {
  const response = await fetch(base + path);
  assert.equal(response.status,200,path);
  return response.json();
}
async function change(path, method, body) {
  return fetch(base + path, {method, headers:jsonHeaders, body:JSON.stringify(body)});
}
async function switchTo(id, name) {
  await selector.selectOption(id);
  await title.getByText(name,{exact:true}).waitFor();
}
async function publish(prefix, lesson, exam, stamp) {
  const file = (name,text) => ({name, mimeType:"text/markdown", buffer:Buffer.from(text)});
  await page.getByLabel("选择资料",{exact:true}).setInputFiles(file("M6讲义-"+stamp+".md",lesson));
  await page.getByLabel("选择试卷",{exact:true}).setInputFiles(file("M6样卷-"+stamp+".md",exam));
  const submitted = page.waitForResponse(r => r.url()===base+prefix+"/jobs" && r.request().method()==="POST");
  await page.getByRole("button",{name:"提交处理"}).click();
  const response = await submitted;
  assert.equal(response.status(),200);
  const {id} = await response.json();
  await page.waitForFunction(job => document.querySelector('[aria-label="处理批次"]')?.value===job,id);
  const published = page.waitForResponse(r => r.url()===base+prefix+"/jobs/"+id+"/analysis");
  await page.getByRole("button",{name:"分析本批资料"}).click();
  const analysis = await published;
  assert.equal(analysis.status(),200);
  return analysis.json();
}
async function study() {
  await page.getByRole("tab",{name:/^复习待办/}).click();
  await notes.waitFor();
}
async function saveNote(value, completed) {
  await study();
  async function save(action) {
    const response = page.waitForResponse(r => r.request().method()==="PUT");
    await action();
    assert.equal((await response).status(),200);
  }
  const check = deadlock.getByRole("checkbox");
  if (await check.isChecked() !== completed) await save(() => check.click());
  await notes.fill(value);
  await save(() => deadlock.getByRole("button",{name:"保存笔记"}).click());
}
async function confirmNote(value, completed) {
  await study();
  await page.waitForFunction(expected => [...document.querySelectorAll("textarea")].some(e=>e.value===expected),value);
  assert.equal(await notes.inputValue(),value);
  assert.equal(await deadlock.getByRole("checkbox").isChecked(),completed);
}
function topicId(ns,name) {
  const bytes = createHash("md5").update(ns+"/"+name,"utf8").digest();
  bytes[6] = (bytes[6] & 15) | 48;
  bytes[8] = (bytes[8] & 63) | 128;
  return bytes.toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.+)$/,"$1-$2-$3-$4-$5");
}
async function verify(saved) {
  for (const course of [saved.database,saved.os]) {
    await switchTo(course.id,course.name);
    await confirmNote(course.note,course.completed);
    assert.equal((await get(course.prefix+"/analysis")).version,course.version);
  }
}
try {
  await page.goto(base);
  await selector.waitFor();
  if (mode==="verify") {
    await verify(JSON.parse(await readFile(stateFile,"utf8")));
    console.log("PASS M6-08 两门课程的原版本、笔记和勾选恢复");
  } else {
    await new Promise((ok,fail)=>fixture.once("error",fail).listen(18442,"127.0.0.1",ok));
    const stamp = Date.now().toString();
    const courses = await get("/api/courses");
    const osName = courses.some(c=>c.name==="操作系统") ? "操作系统:试用"+stamp : "操作系统";
    assert.equal(courses[0].id,"default");
    assert.equal(await selector.inputValue(),"default");
    const dbResult = await publish(legacy,"# 事务\n死锁：事务之间相互等待对方持有的资源。","第1题 解释死锁。",stamp);
    const dbTopic = dbResult.ranked.find(r=>r.topic.name==="死锁");
    assert.equal(dbTopic.id,topicId("数据库原理","死锁"));
    assert.equal(dbTopic.count,1);
    const database = {id:"default",name:"数据库原理",prefix:legacy,version:dbResult.version,note:"数据库笔记 "+stamp,completed:true};
    await saveNote(database.note,true);
    await page.getByRole("button",{name:"新建课程"}).click();
    const create = page.getByRole("button",{name:"创建课程"});
    const input = page.getByLabel("新课程名称");
    await input.fill("  ");
    await create.click();
    await page.getByText("请输入课程名称").waitFor();
    await input.fill(" 数据库原理 ");
    await create.click();
    await page.getByText("同名课程已存在").waitFor();
    for (const bad of [" ","测试/分隔","换\n行","长".repeat(81)]) {
      assert.equal((await change("/api/courses","POST",{name:bad})).status,400);
    }
    const sameName = {name:"并发试用"+stamp+"课".repeat(80-4-stamp.length)};
    const race = await Promise.all([change("/api/courses","POST",sameName),change("/api/courses","POST",sameName)]);
    assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
    await input.fill(osName);
    const created = page.waitForResponse(r=>r.url()===base+"/api/courses" && r.request().method()==="POST");
    await create.click();
    const response = await created;
    assert.equal(response.status(),201);
    const course = await response.json();
    const prefix = "/api/courses/"+course.id;
    await page.getByLabel("复习准备步骤").waitFor();
    assert.equal(await page.title(),osName+" · 个人期末复习助手");
    assert.deepEqual(await get(prefix+"/jobs"),[]);
    assert.deepEqual(await get(prefix+"/files"),[]);
    const lesson = "# 内存管理\n### 最近最少使用置换算法（LRU）\n- 记录最近访问时间\n- 优先移出最久未使用的页面\n死锁是指多个进程循环等待对方持有的资源。\n信号量是指用于控制对共享资源访问的计数机制。\n### 本章小结";
    const exam = "一、名词解释\n1. LRU（3分）\n2. 死锁\n二、简答题\n1. 解释死锁。无需讨论并发控制。";
    const result = await publish(prefix,lesson,exam,stamp);
    const hits = Object.fromEntries(result.ranked.map(r=>[r.topic.name,r]));
    assert.equal(hits["最近最少使用置换算法"].count,1);
    assert.match(hits["最近最少使用置换算法"].topic.text,/；/);
    assert.equal(hits["死锁"].count,2);
    assert.equal(hits["信号量"].count,0);
    assert.equal(hits["死锁"].id,topicId(course.id,"死锁"));
    assert.ok(!hits["并发控制"] && !hits["本章小结"]);
    assert.ok(Object.values(result.sources).every(s=>s.url.startsWith(prefix+"/")));
    assert.deepEqual(await get(prefix+"/jobs"),[result.job]);
    const ownFiles = await get(prefix+"/files");
    const otherFiles = await get(legacy+"/files");
    assert.ok(ownFiles.every(f=>!otherFiles.some(other=>other.id===f.id)));
    const sameBytes = new FormData();
    sameBytes.append("file", new Blob([lesson]),"M6讲义-"+stamp+".md");
    sameBytes.append("role","material");
    const uploaded = await fetch(base+legacy+"/files",{method:"POST",headers:{"X-Review-Request":"1"},body:sameBytes});
    assert.equal(uploaded.status,200);
    assert.notEqual((await uploaded.json()).id,ownFiles.find(f=>f.role==="material").id);
    const os = {id:course.id,name:osName,prefix,version:result.version,note:"操作系统笔记 "+stamp,completed:false};
    await confirmNote("",false);
    await saveNote(os.note,false);
    const dl = page.waitForEvent("download");
    await page.getByText("下载 Markdown 复习文档").click();
    const download = await dl;
    assert.equal(download.suggestedFilename(),osName.replaceAll(":","_")+"-"+result.version+".md");
    const md = await readFile(await download.path(),"utf8");
    assert.equal(md.split("\n")[0],"# "+osName);
    assert.ok(md.includes("### 死锁") && !md.includes(os.note) && !md.includes("### 信号量"));
    const video = page.getByRole("region",{name:"B 站参考视频"});
    await video.getByText(/HTTP 412/).waitFor();
    assert.ok(queries.some(q=>q===osName+" 死锁" || q===osName+" 最近最少使用置换算法"));
    empty = true;
    const retry = video.getByRole("button",{name:"重试视频检索"});
    await retry.click();
    await video.getByText("暂无匹配视频",{exact:true}).waitFor();
    const before = queries.length;
    await retry.click();
    await video.getByText("暂无匹配视频",{exact:true}).waitFor();
    assert.ok(queries.length>before);
    await switchTo("default","数据库原理");
    await confirmNote(database.note,true);
    const extra = await publish(legacy,"# 事务\n死锁：事务之间相互等待对方持有的资源。","第1题 解释死锁。\n第2题 解释死锁。",stamp+"b");
    database.version = extra.version;
    await study();
    await notes.fill("尚未保存的数据库草稿");
    const draftFile = "未提交草稿.md";
    await page.getByLabel("选择课件",{exact:true}).setInputFiles({
      name:draftFile, mimeType:"text/markdown", buffer:Buffer.from("# 草稿"),
    });
    await page.getByLabel("处理批次").selectOption(dbResult.job);
    await page.getByRole("tab",{name:/^真题频次/}).click();
    const card = page.locator(".topic").first();
    await card.locator("summary").click();
    await card.getByRole("button",{name:"页内对照"}).first().click();
    const drawer = page.getByRole("complementary",{name:"页内原文对照"});
    await drawer.waitFor();
    await switchTo(course.id,osName);
    assert.equal(await drawer.count(),0);
    assert.equal(await page.getByText(draftFile,{exact:true}).count(),0);
    await confirmNote(os.note,false);
    await switchTo("default","数据库原理");
    await page.waitForFunction(job=>document.querySelector('[aria-label="处理批次"]')?.value===job,dbResult.job);
    const foreignFile = ownFiles[0].id;
    const root = legacy+"/jobs/"+result.job;
    const version = legacy+"/versions/"+result.version;
    for (const path of [legacy+"/files/"+foreignFile+"/original",root,root+"/"+foreignFile+"/segments",
         root+"/"+foreignFile+"/preview/1",version+"/states",version+"/export",version+"/videos"]) {
      assert.equal((await fetch(base+path)).status,404,path);
    }
    for (const path of [root+"/analysis",root+"/"+foreignFile+"/retry",root+"/"+foreignFile+"/recheck",version+"/videos/retry"]) {
      assert.equal((await change(path,"POST")).status,404,path);
    }
    assert.equal((await change(legacy+"/jobs","POST",{files:[foreignFile]})).status,404);
    assert.equal((await change(legacy+"/versions/"+database.version+"/states/"+hits["死锁"].id,"PUT",{revision:0,note:"foreign"})).status,404);
    assert.equal((await change(legacy+"/versions/"+database.version+"/states/"+hits["死锁"].id,"PUT",{})).status,404);
    await page.reload();
    const longCourse = (await get("/api/courses")).find(c=>c.name===sameName.name);
    await switchTo(longCourse.id,longCourse.name);
    for (const width of [390,1280]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await verify({database,os});
    await mkdir(".local",{recursive:true});
    await writeFile(stateFile,JSON.stringify({database,os}),"utf8");
    console.log("PASS M6-01～07，重启试用后端后运行 verify");
  }
} finally {
  fixture.close();
  await browser.close();
}
