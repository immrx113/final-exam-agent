import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(
  new URL("../web/package.json", import.meta.url),
)("playwright-core");

const base = process.env.REVIEW_TEST_URL || "http://127.0.0.1:18085";
const browser = await chromium.launch({ channel: "msedge", headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const VERSION = "8f2c1122-3344-5566-7788-99aabbccdde0";
  const LONG_CW =
    "2025至2026学年第一学期计算机科学与技术专业数据库原理核心课堂幻灯片关系数据理论与函数依赖专题精讲定稿版.pptx";
  const LONG_EXAM =
    "2025至2026学年第一学期计算机科学与技术专业数据库原理期末考试A卷扫描识别超长文件名防横向溢出边界测试卷.md";

  let useLongNames = false;

  const currentFiles = () => [
    {
      id: "cw-1",
      name: useLongNames ? LONG_CW : "lesson.pptx",
      role: "courseware",
    },
    { id: "mat-1", name: "讲义.pdf", role: "material" },
    {
      id: "exam-md",
      name: useLongNames ? LONG_EXAM : "甲卷.md",
      role: "exam",
    },
    { id: "exam-png", name: "散页.png", role: "exam" },
  ];

  const batchItemsFor = (jobId) => [
    {
      file: "cw-1",
      name: useLongNames ? LONG_CW : `${jobId}-lesson.pptx`,
      role: "courseware",
      status: "ready",
      reason: null,
    },
    {
      file: "exam-md",
      name: useLongNames ? LONG_EXAM : "甲卷.md",
      role: "exam",
      status: "ready",
      reason: null,
    },
  ];

  const buildSnapshot = () => ({
    job: "job-2",
    version: VERSION,
    paperCount: 3,
    plan: [
      {
        topic: "t-ra",
        reason: "讲义明确指出先掌握关系代数基础运算，再学习函数依赖推导。",
        ref: "src-mat",
      },
      {
        topic: "t-fd",
        reason: "高频重点考点，命中 4 题。",
      },
    ],
    ranked: [
      {
        id: "t-fd",
        outlineOrder: 2,
        topic: {
          name: "函数依赖",
          chapter: "关系数据理论",
          text: "设 R(U) 是属性集 U 上的关系模式，X 和 Y 是 U 的子集，若 X 唯一决定 Y，则称 Y 函数依赖于 X。",
          refs: ["src-cw", "src-mat"],
        },
        count: 4,
        papers: 1,
        questions: [
          { label: "1", refs: ["src-q1"] },
          { label: "2", refs: ["src-q2"] },
          { label: "3(1)", refs: ["src-q3-1"] },
          { label: "3(2)", refs: ["src-q3-2"] },
        ],
      },
      {
        id: "t-ra",
        outlineOrder: 1,
        topic: {
          name: "关系代数",
          chapter: "关系数据理论",
          text: "以集合运算和专门的关系运算表达查询。",
          refs: ["src-cw"],
        },
        count: 3,
        papers: 3,
        questions: [
          { label: "4", refs: ["src-q4"] },
          { label: "1", refs: ["src-q5"] },
          { label: "1", refs: ["src-q6"] },
        ],
      },
      {
        id: "t-deadlock",
        outlineOrder: 3,
        topic: {
          name: "死锁",
          chapter: "事务管理",
          text: "多个事务互相等待对方持有的封锁资源。",
          refs: ["src-mat"],
        },
        count: 0,
        papers: 0,
        questions: [],
      },
    ],
    sources: {
      "src-cw": {
        file: "cw-1",
        name: useLongNames ? LONG_CW : "lesson.pptx",
        role: "courseware",
        label: "转换预览第 2 页",
        url: "/api/course/jobs/job-2/cw-1/preview/page-2.png",
        review: false,
      },
      "src-mat": {
        file: "mat-1",
        name: "讲义.pdf",
        role: "material",
        label: "原文第 1 页",
        url: "/api/course/jobs/job-2/mat-1/preview/page-1.png",
        review: false,
      },
      "src-q1": {
        file: "exam-md",
        name: useLongNames ? LONG_EXAM : "甲卷.md",
        role: "exam",
        label: "第 2 行",
        url: "/api/course/jobs/job-2/exam-md/preview/lines.html#L2",
        review: false,
      },
      "src-q2": {
        file: "exam-md",
        name: useLongNames ? LONG_EXAM : "甲卷.md",
        role: "exam",
        label: "第 3 行",
        url: "/api/course/jobs/job-2/exam-md/preview/lines.html#L3",
        review: false,
      },
      "src-q3-1": {
        file: "exam-md",
        name: useLongNames ? LONG_EXAM : "甲卷.md",
        role: "exam",
        label: "第 4 行",
        url: "/api/course/jobs/job-2/exam-md/preview/lines.html#L4",
        review: false,
      },
      "src-q3-2": {
        file: "exam-png",
        name: "散页.png",
        role: "exam",
        label: "原图",
        url: "/api/course/jobs/job-2/exam-png/preview/image.png",
        review: false,
      },
      "src-q4": {
        file: "exam-md",
        name: useLongNames ? LONG_EXAM : "甲卷.md",
        role: "exam",
        label: "第 6 行",
        url: "/api/course/jobs/job-2/exam-md/preview/lines.html#L6",
        review: false,
      },
      "src-q5": {
        file: "exam-png",
        name: "乙卷.png",
        role: "exam",
        label: "原图",
        url: "/api/course/jobs/job-2/exam-png/preview/image.png",
        review: false,
      },
      "src-q6": {
        file: "exam-png",
        name: "丙卷.png",
        role: "exam",
        label: "原图",
        url: "/api/course/jobs/job-2/exam-png/preview/image.png",
        review: false,
      },
      "src-rev": {
        file: "exam-png",
        name: "散页.png",
        role: "exam",
        label: "原图",
        url: "/api/course/jobs/job-2/exam-png/preview/image.png",
        review: true,
      },
    },
    reviews: [
      {
        reason: "散页未识别到明确卷头，暂未纳入统计分母",
        refs: ["src-rev"],
      },
    ],
  });

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  await page.route("**/api/course/files", (route) =>
    route.fulfill({ json: currentFiles() }),
  );
  await page.route("**/api/course/jobs", (route) =>
    route.fulfill({ json: ["job-3", "job-2", "job-1"] }),
  );
  let failedTask;
  await page.route("**/api/course/jobs/*/analysis-tasks", route => {
    if (route.request().method() === "POST") {
      failedTask = { id: "ui-timeout", job: "job-1", requestId: route.request().postDataJSON().requestId,
        state: "failed", attempts: 3, reason: "分析超时，请重试" };
      return route.fulfill({ status: 202, json: failedTask });
    }
    return failedTask ? route.fulfill({ json: failedTask }) : route.fulfill({ status: 204 });
  });
  await page.route("**/api/course/analysis-tasks/ui-timeout", route => route.fulfill({ json: failedTask }));
  await page.route("**/api/course/jobs/*/exam-md/preview/lines.html", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: [
        "<!doctype html><ol>",
        '<li id="L1"><pre>数据库原理甲卷</pre></li>',
        '<li id="L2"><pre>第1题 解释函数依赖的基本定义。</pre></li>',
        '<li id="L3"><pre>第2题 判断平凡与非平凡函数依赖。</pre></li>',
        '<li id="L4"><pre>第3(1)题 求关系模式 R 的所有非平凡函数依赖。</pre></li>',
        '<li id="L5"><pre>第3(2)题 说明候选键推导过程。</pre></li>',
        '<li id="L6"><pre>第4题 用关系代数表达式写出查询。</pre></li>',
        "</ol>",
      ].join(""),
    }),
  );
  await page.route("**/api/course/jobs/*/*/preview/*.png", (route) =>
    route.fulfill({ contentType: "image/png", body: tinyPng }),
  );
  await page.route("**/api/course/jobs/*", (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    const jobId = parts[parts.length - 1];
    return route.fulfill({ json: batchItemsFor(jobId) });
  });
  await page.route("**/api/course/analysis", (route) =>
    route.fulfill({ json: buildSnapshot() }),
  );
  await page.route(`**/api/course/versions/${VERSION}/states`, (route) =>
    route.fulfill({
      json: [
        { topic: "t-fd", revision: 1, completed: true, note: "函数依赖初稿" },
        { topic: "t-ra", revision: 2, completed: false, note: "旧版笔记" },
      ],
    }),
  );
  await page.route(`**/api/course/versions/${VERSION}/states/*`, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        topic: "t-ra",
        revision: 3,
        completed: false,
        note: "已存版本",
      }),
    }),
  );
  await page.route(`**/api/course/versions/${VERSION}/videos`, (route) =>
    route.fulfill({
      json: {
        status: "partial",
        reason: "公开搜索未完成（HTTP 412）。 推荐来自课程 BV 候选目录。",
        items: [
          {
            url: "https://www.bilibili.com/video/BV1111111111/",
            title: useLongNames
              ? "数据库系统概论全套精讲合集之关系代数核心算子连接与除运算逐题推演"
              : "2.4 关系代数专项合集单集",
            target: "合集单集",
            topics: ["关系代数"],
            views: 5600,
            likes: 320,
            favorites: 180,
          },
          {
            url: "https://www.bilibili.com/video/BV13T4y1f7dn/?p=8",
            title: "数据库系统概论 · 函数依赖",
            target: "分 P",
            topics: ["函数依赖"],
            views: 128400,
            likes: 3210,
            favorites: null,
          },
        ],
      },
    }),
  );

  // =========================================================================
  // UI-01: 新旧批次并存与版本归属展示（504 超时不丢失已发布铭牌与当前激活页签）
  // =========================================================================
  await page.goto(base);
  const analysisSection = page.getByRole("region", { name: "课程分析" });
  const studyTab = analysisSection.getByRole("tab", { name: /^复习待办/ });
  await studyTab.click();
  await assert.doesNotReject(() =>
    analysisSection.getByText("已完成 1/2").waitFor(),
  );
  assert.equal(await studyTab.getAttribute("aria-selected"), "true");

  const batchSelect = page.getByLabel("处理批次");
  await batchSelect.selectOption("job-1");
  const batchRegion = page.getByRole("region", { name: "当前批次工作区" });
  await batchRegion.getByText("正在处理 · 第 1 批").waitFor();

  const analyzeBtn = page.getByRole("button", { name: "分析本批资料" });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "分析本批资料" && !b.disabled,
      ),
  );
  await analyzeBtn.click();
  await batchRegion.getByText("分析超时，请重试").waitFor();

  await analysisSection
    .getByText("当前阅读仍是：第 2 批已发布结果")
    .waitFor();
  await analysisSection.getByText(/版本 #8f2c/).first().waitFor();
  await analysisSection
    .getByText(/对应 第 2 批（版本 #8f2c，仅含正命中考点，不含笔记）/)
    .waitFor();
  assert.equal(await studyTab.getAttribute("aria-selected"), "true");

  // =========================================================================
  // UI-02: 页内原文对照、目标行高亮、原件下载与 Esc 焦点归还 + 刚查看标记
  // =========================================================================
  const rankTab = analysisSection.getByRole("tab", { name: /^真题频次/ });
  await rankTab.click();
  const fdCard = analysisSection.locator(".topic").first();
  await fdCard.locator("summary").click();

  assert.deepEqual(
    await fdCard.locator(".source-role-badge").allTextContents(),
    ["课件", "资料"],
  );
  assert.equal(await fdCard.locator("li").count(), 4);

  const q3Item = fdCard.locator("li").nth(2);
  const compareBtn = q3Item.getByRole("button", { name: "页内对照" });
  await compareBtn.click();

  const drawer = page.getByRole("complementary", { name: "页内原文对照" });
  await drawer.waitFor();
  const targetLine = drawer.locator("#drawer-L4");
  await targetLine.waitFor();
  assert.equal(await targetLine.getAttribute("data-target-line"), "true");
  assert.equal(await targetLine.getAttribute("aria-current"), "location");
  assert.match(await targetLine.innerText(), /第3\(1\)题/);
  assert.equal(
    await drawer.getByRole("link", { name: "下载原件" }).getAttribute("href"),
    "/api/course/files/exam-md/original",
  );

  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached" });
  const expectedKey = await compareBtn.getAttribute("data-evidence-key");
  const focusedKey = await page.evaluate(
    () => document.activeElement?.getAttribute("data-evidence-key") ?? null,
  );
  assert.equal(focusedKey, expectedKey);
  await q3Item.getByText("刚查看").waitFor();

  // =========================================================================
  // UI-03: 页签键盘方向键切换与“参考计划 → 去待办记笔记”自动聚焦跳转
  // =========================================================================
  await rankTab.focus();
  await page.keyboard.press("ArrowRight");
  const chaptersTab = analysisSection.getByRole("tab", { name: /^章节目录/ });
  assert.equal(await chaptersTab.getAttribute("aria-selected"), "true");
  assert.equal(await analysisSection.locator("h3").count(), 1);

  await page.keyboard.press("ArrowRight");
  const planTab = analysisSection.getByRole("tab", { name: /^参考计划/ });
  assert.equal(await planTab.getAttribute("aria-selected"), "true");

  const firstStep = analysisSection.locator("ol > li").first();
  await firstStep.getByRole("button", { name: "去待办记笔记" }).click();
  assert.equal(await studyTab.getAttribute("aria-selected"), "true");
  await page.waitForFunction(() => document.activeElement?.id === "note-t-ra");

  // =========================================================================
  // UI-04: 409 冲突并列核对与独立视频区统计层级（合集单集 vs 分 P）
  // =========================================================================
  const raStudyItem = analysisSection
    .locator(".study-item")
    .filter({ has: page.getByLabel("学习笔记 · 关系代数", { exact: true }) });
  const raTextarea = raStudyItem.locator("textarea#note-t-ra");
  await raTextarea.fill("本地草稿");
  await raStudyItem.getByRole("button", { name: "保存笔记" }).click();

  const conflictRegion = raStudyItem.getByRole("region", {
    name: "笔记冲突核对 · 关系代数",
  });
  await conflictRegion.waitFor();
  assert.match(await conflictRegion.innerText(), /已存版本/);
  assert.match(await conflictRegion.innerText(), /本地草稿/);

  await conflictRegion
    .getByRole("button", { name: "填入已保存内容" })
    .click();
  assert.equal(await raTextarea.inputValue(), "已存版本");
  await conflictRegion.waitFor({ state: "detached" });

  assert.equal(
    await analysisSection
      .locator('section[aria-label="B 站参考视频"]')
      .count(),
    0,
  );
  const videoSection = page.getByRole("region", { name: "B 站参考视频" });
  await videoSection.waitFor();
  assert.equal(await videoSection.locator("h3").count(), 0);
  assert.equal(await videoSection.getByRole("link").count(), 2);
  await videoSection.getByText(/HTTP 412/).waitFor();
  await videoSection.getByRole("button", { name: "重试视频检索" }).waitFor();
  await videoSection
    .getByText("单集数据 · 播放 5,600 · 点赞 320 · 收藏 180")
    .waitFor();
  await videoSection
    .getByText("整条视频 · 播放 128,400 · 点赞 3,210 · 收藏 未取得")
    .waitFor();

  // =========================================================================
  // UI-05: 60 字超长中文文件名在 1280×800 与 390×844 防横向溢出及窄屏底部抽屉
  // =========================================================================
  useLongNames = true;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.locator(".saved-files summary").click();
  await analysisSection.locator(".topic").first().locator("summary").click();
  await analysisSection
    .locator(".topic")
    .first()
    .getByRole("button", { name: "页内对照" })
    .first()
    .click();
  await drawer.waitFor();

  const checkNoHorizontalOverflow = async (label) => {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert.ok(
      metrics.scrollWidth <= metrics.innerWidth,
      `${label} 出现横向溢出: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
    );
  };

  await checkNoHorizontalOverflow("1280×800 双栏页内对照态");
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached" });

  await page.setViewportSize({ width: 390, height: 844 });
  await checkNoHorizontalOverflow("390×844 快捷导入与长文件名态");

  await page.getByRole("button", { name: "展开三栏说明" }).click();
  await checkNoHorizontalOverflow("390×844 展开三栏导入面板态");

  await analysisSection
    .locator(".topic")
    .first()
    .getByRole("button", { name: "页内对照" })
    .first()
    .click();
  await drawer.waitFor();
  const drawerPosition = await drawer.evaluate(
    (el) => getComputedStyle(el).position,
  );
  assert.equal(drawerPosition, "fixed");
  await checkNoHorizontalOverflow("390×844 底部模态抽屉展开态");

  await drawer.getByRole("button", { name: "关闭" }).click();
  await drawer.waitFor({ state: "detached" });
  await checkNoHorizontalOverflow("390×844 底部模态抽屉关闭态");

  assert.deepEqual(pageErrors, []);
  console.log("PASS UI-01..UI-05 frontend refactor suite");
} finally {
  await browser.close();
}
