import { waitForPublication } from "../r2-tests/publication.mjs";
// Prepare, restart the dedicated Java service, then verify against its saved versions.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const base = process.env.REVIEW_TEST_URL;
if (!["http://127.0.0.1:18085", "http://127.0.0.1:18087", "http://127.0.0.1:18127", "http://127.0.0.1:18130"].includes(base)) {
  throw Error("REVIEW_TEST_URL 须指向 18085、18087、18127 或 18130 独立试用实例");
}
const mode = process.argv[2];
assert.ok(["prepare", "verify"].includes(mode), "使用 prepare 或 verify");
const stateFile = ".local/m6-checkpoint-" + new URL(base).port + ".json";
const { chromium } = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const legacy = "/api/course";
const jsonHeaders = { "Content-Type": "application/json", "X-Review-Request": "1" };
const title = page.getByRole("heading", { level: 1 });
const switcherBtn = page.getByLabel("当前课程", { exact: true });
const popover = page.getByRole("dialog", { name: "切换与管理课程" });
const notes = page.getByLabel("学习笔记 · 死锁", { exact: true });
const deadlock = page.locator(".study-item").filter({ has: notes });
let empty = false;
const queries = [];
const fixture = createServer((req, res) => {
  const url = new URL(req.url, base);
  if (url.pathname.endsWith("/type")) queries.push(url.searchParams.get("keyword"));
  if (!empty) return res.writeHead(412).end();
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ code: 0, data: { result: [] } }));
});

async function get(path) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  return response.json();
}
async function change(path, method, body) {
  return fetch(base + path, {
    method,
    headers: jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function openSwitcher() {
  if ((await switcherBtn.getAttribute("aria-expanded")) !== "true") {
    await switcherBtn.click();
  }
  await popover.waitFor();
}
async function switchTo(id, name) {
  await openSwitcher();
  await popover.getByRole("button", { name, exact: true }).click();
  await popover.waitFor({ state: "detached" });
  await title.getByText(name, { exact: true }).waitFor();
  assert.equal((await switcherBtn.innerText()).trim(), name);
}
async function publish(prefix, lesson, exam, stamp) {
  const file = (name, text) => ({ name, mimeType: "text/markdown", buffer: Buffer.from(text) });
  await page.getByLabel("选择资料", { exact: true }).setInputFiles(file("M6讲义-" + stamp + ".md", lesson));
  await page.getByLabel("选择试卷", { exact: true }).setInputFiles(file("M6样卷-" + stamp + ".md", exam));
  const submitted = page.waitForResponse(r => r.url() === base + prefix + "/jobs" && r.request().method() === "POST");
  await page.getByRole("button", { name: "提交处理" }).click();
  const response = await submitted;
  assert.equal(response.status(), 200);
  const { id } = await response.json();
  await page.waitForFunction(job => document.querySelector('[aria-label="处理批次"]')?.value === job, id);
  const published = waitForPublication(page);
  await page.getByRole("button", { name: "分析本批资料" }).click();
  const analysis = await published;
  assert.equal(analysis.status(), 200);
  return analysis.json();
}
async function study() {
  await page.getByRole("tab", { name: /^复习待办/ }).click();
  await notes.waitFor();
}
async function saveNote(value, completed) {
  await study();
  async function save(action) {
    const response = page.waitForResponse(r => r.request().method() === "PUT");
    await action();
    assert.equal((await response).status(), 200);
  }
  const check = deadlock.getByRole("checkbox");
  if ((await check.isChecked()) !== completed) await save(() => check.click());
  await notes.fill(value);
  await save(() => deadlock.getByRole("button", { name: "保存笔记" }).click());
}
async function confirmNote(value, completed) {
  await study();
  await page.waitForFunction(expected => [...document.querySelectorAll("textarea")].some(e => e.value === expected), value);
  assert.equal(await notes.inputValue(), value);
  assert.equal(await deadlock.getByRole("checkbox").isChecked(), completed);
}
function topicId(ns, name) {
  const bytes = createHash("md5").update(ns + "/" + name, "utf8").digest();
  bytes[6] = (bytes[6] & 15) | 48;
  bytes[8] = (bytes[8] & 63) | 128;
  return bytes.toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.+)$/, "$1-$2-$3-$4-$5");
}
async function checkViewportBounds(label, expectPopoverOpen = false) {
  const metrics = await page.evaluate((checkOpen) => {
    const pop = document.querySelector(".course-popover");
    const rect = pop ? pop.getBoundingClientRect() : null;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      popoverLeft: rect ? rect.left : 0,
      popoverRight: rect ? rect.right : 0,
      hasPopover: Boolean(pop),
    };
  }, expectPopoverOpen);
  assert.ok(
    metrics.scrollWidth <= metrics.innerWidth,
    `${label} 横向溢出: ${metrics.scrollWidth} > ${metrics.innerWidth}`,
  );
  if (expectPopoverOpen) {
    assert.ok(metrics.hasPopover, `${label} 浮层未打开`);
    assert.ok(
      metrics.popoverLeft >= 0 && metrics.popoverRight <= metrics.innerWidth + 0.5,
      `${label} 浮层越出视口: [${metrics.popoverLeft}, ${metrics.popoverRight}] / ${metrics.innerWidth}`,
    );
  }
}
async function verify(saved) {
  for (const course of [saved.database, saved.os]) {
    await switchTo(course.id, course.name);
    await confirmNote(course.note, course.completed);
    assert.equal((await get(course.prefix + "/analysis")).version, course.version);
  }
}

try {
  await page.goto(base);
  await switcherBtn.waitFor();
  if (mode === "verify") {
    await verify(JSON.parse(await readFile(stateFile, "utf8")));
    console.log("PASS M6-08 两门课程（含改名后的自建课程）原版本、笔记和勾选恢复");
  } else {
    await new Promise((ok, fail) => fixture.once("error", fail).listen(18442, "127.0.0.1", ok));
    const stamp = Date.now().toString();
    const courses = await get("/api/courses");
    const osName = courses.some(c => c.name === "操作系统") ? "操作系统:试用" + stamp : "操作系统";
    assert.equal(courses[0].id, "default");
    assert.equal((await switcherBtn.innerText()).trim(), "数据库原理");

    // M6-01: 默认课程分析与待办保存
    const dbResult = await publish(legacy, "# 事务\n死锁：事务之间相互等待对方持有的资源。", "第1题 解释死锁。", stamp);
    const dbTopic = dbResult.ranked.find(r => r.topic.name === "死锁");
    assert.equal(dbTopic.id, topicId("数据库原理", "死锁"));
    assert.equal(dbTopic.count, 1);
    const database = { id: "default", name: "数据库原理", prefix: legacy, version: dbResult.version, note: "数据库笔记 " + stamp, completed: true };
    await saveNote(database.note, true);

    // M6-02 & M6-09(默认课保护): 浮层不推挤页面、极简列表、默认课无删改入口、Esc/外部点击关闭与新建校验
    const getH1DocTop = () => title.evaluate(el => Math.round(el.getBoundingClientRect().top + window.scrollY));
    const h1TopBefore = await getH1DocTop();
    await openSwitcher();
    assert.equal(await getH1DocTop(), h1TopBefore, "展开课程浮层不应推挤页面主体");
    assert.equal(
      await popover.getByRole("button", { name: "数据库原理", exact: true }).getAttribute("aria-current"),
      "true",
    );
    assert.equal(await popover.getByRole("button", { name: "重命名课程 · 数据库原理" }).count(), 0);
    assert.equal(await popover.getByRole("button", { name: "删除课程 · 数据库原理" }).count(), 0);
    const listText = await popover.locator(".course-menu-list").innerText();
    assert.ok(!/已发布|待导入/.test(listText), "极简课程列表不应展示发布状态标签");

    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
      "当前课程",
    );

    await openSwitcher();
    await page.locator(".brand-title").click();
    await popover.waitFor({ state: "detached" });

    await openSwitcher();
    await popover.getByRole("button", { name: "新建课程", exact: true }).click();
    assert.equal(await getH1DocTop(), h1TopBefore, "浮层内新建表单不应推挤页面主体");
    const create = popover.getByRole("button", { name: "创建课程", exact: true });
    const input = popover.getByLabel("新课程名称");
    await input.fill("  ");
    await create.click();
    await popover.getByText("请输入课程名称").waitFor();
    await input.fill(" 数据库原理 ");
    await create.click();
    await popover.getByText("同名课程已存在").waitFor();

    for (const bad of [" ", "测试/分隔", "换\n行", "长".repeat(81)]) {
      assert.equal((await change("/api/courses", "POST", { name: bad })).status, 400);
    }
    assert.equal((await change("/api/courses/default", "PATCH", { name: "禁止改默认课" })).status, 400);
    assert.equal((await change("/api/courses/default", "PUT", { name: "禁止改默认课" })).status, 400);
    assert.equal((await change("/api/courses/default", "DELETE")).status, 400);
    assert.equal((await change("/api/courses/00000000-0000-0000-0000-000000000000", "PATCH", { name: "不存在" })).status, 404);
    assert.equal((await change("/api/courses/00000000-0000-0000-0000-000000000000", "DELETE")).status, 404);

    const sameName = { name: "并发试用" + stamp + "课".repeat(80 - 4 - stamp.length) };
    const race = await Promise.all([change("/api/courses", "POST", sameName), change("/api/courses", "POST", sameName)]);
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);

    await input.fill(osName);
    const created = page.waitForResponse(r => r.url() === base + "/api/courses" && r.request().method() === "POST");
    await create.click();
    const response = await created;
    assert.equal(response.status(), 201);
    await popover.waitFor({ state: "detached" });
    const course = await response.json();
    const prefix = "/api/courses/" + course.id;
    await page.getByLabel("复习准备步骤").waitFor();
    assert.equal(await page.title(), osName + " · 个人期末复习助手");
    assert.equal((await switcherBtn.innerText()).trim(), osName);
    assert.deepEqual(await get(prefix + "/jobs"), []);
    assert.deepEqual(await get(prefix + "/files"), []);

    // M6-03, M6-04 & M6-06: 非数据库课轻量自举提取、同名考点笔记隔离、导出与视频检索
    const lesson = "# 内存管理\n### 最近最少使用置换算法（LRU）\n- 记录最近访问时间\n- 优先移出最久未使用的页面\n死锁是指多个进程循环等待对方持有的资源。\n信号量是指用于控制对共享资源访问的计数机制。\n### 本章小结";
    const exam = "一、名词解释\n1. LRU（3分）\n2. 死锁\n二、简答题\n1. 解释死锁。无需讨论并发控制。";
    const result = await publish(prefix, lesson, exam, stamp);
    const hits = Object.fromEntries(result.ranked.map(r => [r.topic.name, r]));
    assert.equal(hits["最近最少使用置换算法"].count, 1);
    assert.match(hits["最近最少使用置换算法"].topic.text, /；/);
    assert.equal(hits["死锁"].count, 2);
    assert.equal(hits["信号量"].count, 0);
    assert.equal(hits["死锁"].id, topicId(course.id, "死锁"));
    assert.ok(!hits["并发控制"] && !hits["本章小结"]);
    assert.ok(Object.values(result.sources).every(s => s.url.startsWith(prefix + "/")));
    assert.deepEqual(await get(prefix + "/jobs"), [result.job]);
    const ownFiles = await get(prefix + "/files");
    const otherFiles = await get(legacy + "/files");
    assert.ok(ownFiles.every(f => !otherFiles.some(other => other.id === f.id)));

    const sameBytes = new FormData();
    sameBytes.append("file", new Blob([lesson]), "M6讲义-" + stamp + ".md");
    sameBytes.append("role", "material");
    const uploaded = await fetch(base + legacy + "/files", { method: "POST", headers: { "X-Review-Request": "1" }, body: sameBytes });
    assert.equal(uploaded.status, 200);
    const sharedDbFileId = (await uploaded.json()).id;
    assert.notEqual(sharedDbFileId, ownFiles.find(f => f.role === "material").id);

    const os = { id: course.id, name: osName, prefix, version: result.version, note: "操作系统笔记 " + stamp, completed: false };
    await confirmNote("", false);
    await saveNote(os.note, false);

    const dl = page.waitForEvent("download");
    await page.getByText("下载 Markdown 复习文档").click();
    const download = await dl;
    assert.equal(download.suggestedFilename(), osName.replaceAll(":", "_") + "-" + result.version + ".md");
    const md = await readFile(await download.path(), "utf8");
    assert.equal(md.split("\n")[0], "# " + osName);
    assert.ok(md.includes("### 死锁") && !md.includes(os.note) && !md.includes("### 信号量"));

    const video = page.getByRole("region", { name: "B 站参考视频" });
    await video.getByText(/HTTP 412/).waitFor();
    assert.ok(queries.some(q => q === osName + " 死锁" || q === osName + " 最近最少使用置换算法"));
    empty = true;
    const retry = video.getByRole("button", { name: "重试视频检索" });
    await retry.click();
    await video.getByText("暂无匹配视频", { exact: true }).waitFor();
    const before = queries.length;
    await retry.click();
    await video.getByText("暂无匹配视频", { exact: true }).waitFor();
    assert.ok(queries.length > before);

    // M6-05: 跨课程切换时的草稿暂存（待上传文件、复用文件勾选、待办未保存笔记）与原文抽屉隔离
    await switchTo("default", "数据库原理");
    await confirmNote(database.note, true);
    const extra = await publish(legacy, "# 事务\n死锁：事务之间相互等待对方持有的资源。", "第1题 解释死锁。\n第2题 解释死锁。", stamp + "b");
    database.version = extra.version;

    await study();
    const unsavedNoteDraft = "尚未保存的数据库草稿 " + stamp;
    await notes.fill(unsavedNoteDraft);
    const draftFile = "未提交草稿-" + stamp + ".md";
    await page.getByLabel("选择课件", { exact: true }).setInputFiles({
      name: draftFile, mimeType: "text/markdown", buffer: Buffer.from("# 草稿"),
    });
    await page.getByText(draftFile, { exact: true }).waitFor();
    await page.locator(".saved-files summary").click();
    const firstSavedCheck = page.locator(".saved-row input[type='checkbox']").first();
    await firstSavedCheck.check();
    assert.equal(await firstSavedCheck.isChecked(), true);

    await page.getByLabel("处理批次").selectOption(dbResult.job);
    await page.getByRole("tab", { name: /^真题频次/ }).click();
    const card = page.locator(".topic").first();
    await card.locator("summary").click();
    await card.getByRole("button", { name: "页内对照" }).first().click();
    const drawer = page.getByRole("complementary", { name: "页内原文对照" });
    await drawer.waitFor();

    // Esc 捕获层级校验：浮层与原文对照同时打开时，按 Esc 仅关闭课程浮层，不误关原文对照抽屉
    await openSwitcher();
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "detached" });
    assert.equal(await drawer.count(), 1, "关闭课程浮层时不应误关底层原文对照抽屉");

    // 切到操作系统：抽屉关闭、数据库草稿不串入
    await switchTo(course.id, osName);
    assert.equal(await drawer.count(), 0);
    assert.equal(await page.getByText(draftFile, { exact: true }).count(), 0);
    await confirmNote(os.note, false);

    // 切回数据库原理：记忆批次、待上传草稿、复用勾选与待办笔记草稿全部自动恢复
    await switchTo("default", "数据库原理");
    await page.waitForFunction(job => document.querySelector('[aria-label="处理批次"]')?.value === job, dbResult.job);
    await page.getByText(draftFile, { exact: true }).waitFor();
    await page.locator(".saved-files summary").click();
    assert.equal(await page.locator(".saved-row input[type='checkbox']").first().isChecked(), true);
    await study();
    assert.equal(await notes.inputValue(), unsavedNoteDraft, "切回课程后应恢复未保存笔记草稿");

    // 清理临时未提交草稿，保持数据库原理为已保存基线以备重启校验
    await page.locator(".saved-row input[type='checkbox']").first().uncheck();
    await page.locator(".draft").filter({ hasText: draftFile }).getByRole("button", { name: "移除" }).click();
    assert.equal(await page.getByText(draftFile, { exact: true }).count(), 0);
    await notes.fill(database.note);

    // M6-07: 跨课越权访问防护
    const foreignFile = ownFiles[0].id;
    const root = legacy + "/jobs/" + result.job;
    const version = legacy + "/versions/" + result.version;
    for (const path of [legacy + "/files/" + foreignFile + "/original", root, root + "/" + foreignFile + "/segments",
      root + "/" + foreignFile + "/preview/1", version + "/states", version + "/export", version + "/videos"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    for (const path of [root + "/analysis", root + "/" + foreignFile + "/retry", root + "/" + foreignFile + "/recheck", version + "/videos/retry"]) {
      assert.equal((await change(path, "POST")).status, 404, path);
    }
    assert.equal((await change(legacy + "/jobs", "POST", { files: [foreignFile] })).status, 404);
    assert.equal((await change(legacy + "/versions/" + database.version + "/states/" + hits["死锁"].id, "PUT", { revision: 0, note: "foreign" })).status, 404);
    assert.equal((await change(legacy + "/versions/" + database.version + "/states/" + hits["死锁"].id, "PUT", {})).status, 404);

    // M6-09(重命名): 自建课程重命名校验、无损保留笔记与动态更新导出标题
    await switchTo(course.id, osName);
    await openSwitcher();
    await popover.getByRole("button", { name: "重命名课程 · " + osName, exact: true }).click();
    const renameInput = popover.getByLabel("课程新名称");
    const saveRenameBtn = popover.getByRole("button", { name: "保存", exact: true });
    await renameInput.fill("   ");
    await saveRenameBtn.click();
    await popover.getByText("请输入课程名称").waitFor();
    await renameInput.fill(" 数据库原理 ");
    await saveRenameBtn.click();
    await popover.getByText("同名课程已存在").waitFor();
    for (const bad of ["含/斜杠", "含\\斜杠", "换\n行", "长".repeat(81)]) {
      assert.equal((await change("/api/courses/" + course.id, "PATCH", { name: bad })).status, 400);
    }
    // 未修改名称直接保存无副作用退出编辑态
    await renameInput.fill("  " + osName + "  ");
    await saveRenameBtn.click();
    await popover.getByRole("button", { name: "重命名课程 · " + osName, exact: true }).waitFor();

    const osRenamed = osName + "（精修）";
    await popover.getByRole("button", { name: "重命名课程 · " + osName, exact: true }).click();
    await popover.getByLabel("课程新名称").fill(osRenamed);
    const renameResp = page.waitForResponse(
      r => r.url() === base + "/api/courses/" + course.id && r.request().method() === "PATCH",
    );
    await popover.getByRole("button", { name: "保存", exact: true }).click();
    assert.equal((await renameResp).status(), 200);
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "detached" });

    assert.equal((await switcherBtn.innerText()).trim(), osRenamed);
    await title.getByText(osRenamed, { exact: true }).waitFor();
    assert.equal(await page.title(), osRenamed + " · 个人期末复习助手");
    await confirmNote(os.note, false);

    const dlRenamed = page.waitForEvent("download");
    await page.getByText("下载 Markdown 复习文档").click();
    const downloadRenamed = await dlRenamed;
    assert.equal(downloadRenamed.suggestedFilename(), osRenamed.replaceAll(":", "_") + "-" + result.version + ".md");
    const mdRenamed = await readFile(await downloadRenamed.path(), "utf8");
    assert.equal(mdRenamed.split("\n")[0], "# " + osRenamed);
    os.name = osRenamed;

    // M6-09(二次确认删除与双视口防溢出): 80 字符课程双视口检查、发布数据后二次确认删除与级联清理
    await page.reload();
    const longCourse = (await get("/api/courses")).find(c => c.name === sameName.name);
    assert.ok(longCourse, "应存在 80 字符并发试用课程");
    await switchTo(longCourse.id, longCourse.name);

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await checkViewportBounds(`${width}px 顶栏超长课名闭合态`, false);
      await openSwitcher();
      await checkViewportBounds(`${width}px 顶栏超长课名浮层展开态`, true);
      await popover.getByRole("button", { name: "删除课程 · " + longCourse.name, exact: true }).click();
      await checkViewportBounds(`${width}px 顶栏超长课名删除确认态`, true);
      await popover.getByRole("button", { name: "取消", exact: true }).click();
      await page.keyboard.press("Escape");
      await popover.waitFor({ state: "detached" });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    const longPrefix = "/api/courses/" + longCourse.id;
    const longAnalysis = await publish(longPrefix, "# 管程\n管程是指封装共享变量与操作的同步机制。", "第1题 解释管程。", stamp + "long");
    await page.getByRole("tab", { name: /^复习待办/ }).click();
    const longNotes = page.getByLabel("学习笔记 · 管程", { exact: true });
    await longNotes.waitFor();
    await longNotes.fill("待删课程已存笔记");
    const saveLong = page.waitForResponse(r => r.request().method() === "PUT");
    await page.locator(".study-item").filter({ has: longNotes }).getByRole("button", { name: "保存笔记" }).click();
    assert.equal((await saveLong).status(), 200);
    await page.getByLabel("选择课件", { exact: true }).setInputFiles({
      name: "待删草稿.md", mimeType: "text/markdown", buffer: Buffer.from("# 草稿"),
    });

    // 先点取消不删除，再点确认删除
    await openSwitcher();
    await popover.getByRole("button", { name: "删除课程 · " + longCourse.name, exact: true }).click();
    await popover.getByRole("group", { name: "确认删除 · " + longCourse.name }).waitFor();
    await popover.getByRole("button", { name: "取消", exact: true }).click();
    await popover.getByRole("button", { name: longCourse.name, exact: true }).waitFor();

    await popover.getByRole("button", { name: "删除课程 · " + longCourse.name, exact: true }).click();
    const delResp = page.waitForResponse(
      r => r.url() === base + "/api/courses/" + longCourse.id && r.request().method() === "DELETE",
    );
    await popover.getByRole("button", { name: "确认删除", exact: true }).click();
    assert.equal((await delResp).status(), 204);
    await popover.waitFor({ state: "detached" });

    // 删除当前课程后自动回退《数据库原理》，且已删课程全部接口返回 404、共享底层原件不受影响
    await title.getByText("数据库原理", { exact: true }).waitFor();
    assert.equal((await switcherBtn.innerText()).trim(), "数据库原理");
    assert.equal(await page.evaluate(id => sessionStorage.getItem("selected-job:" + id), longCourse.id), null);
    assert.ok(!(await get("/api/courses")).some(c => c.id === longCourse.id));
    for (const gone of [
      longPrefix + "/files",
      longPrefix + "/jobs",
      longPrefix + "/analysis",
      longPrefix + "/versions/" + longAnalysis.version + "/states",
      longPrefix + "/versions/" + longAnalysis.version + "/export",
    ]) {
      assert.equal((await fetch(base + gone)).status, 404, gone);
    }
    const sharedDownload = await fetch(base + legacy + "/files/" + sharedDbFileId + "/original");
    assert.equal(sharedDownload.status, 200);
    assert.equal(await sharedDownload.text(), lesson);

    await verify({ database, os });
    await mkdir(".local", { recursive: true });
    await writeFile(stateFile, JSON.stringify({ database, os }), "utf8");
    console.log("PASS M6-01～07 & M6-09，重启试用后端后运行 verify");
  }
} finally {
  fixture.close();
  await browser.close();
}
