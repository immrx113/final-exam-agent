import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(new URL("../web/package.json", import.meta.url))("playwright-core");
const base = process.env.REVIEW_TEST_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const job = "example";
  await page.route("**/api/course/files", route => route.fulfill({ json: [] }));
  await page.route("**/api/course/jobs", route => route.fulfill({ json: [job] }));
  await page.route("**/api/course/jobs/example", route => route.fulfill({ json: [] }));
  const rows = ["主键", "视图"].map((name, i) => ({
    id: String(i), topic: { name, chapter: "章节" + i, text: name, refs: [] },
    count: 1-i, papers: 1-i, questions: [],
  }));
  for (const [paperCount, ranked, expected] of [
    [1, rows, ["主键"]], [1, rows.slice(1), []], [0, rows.map(r => ({...r, count:0, papers:0})), ["主键","视图"]],
  ]) {
    await page.route("**/api/course/analysis", route => route.fulfill({
      json: { job, version: "test", paperCount, ranked, sources: {}, reviews: [] },
    }));
    await page.goto(base);
    const section = page.getByRole("region", { name: "课程分析" });
    await section.getByText(new RegExp(expected.length + " 个知识点")).waitFor();
    for (const [view, label] of [["rank", /^真题频次/], ["chapters", /^章节目录/]]) {
      await section.getByRole("tab", { name: label }).click();
      assert.deepEqual(await section.locator(".topic summary strong").allTextContents(), expected);
      if (view === "chapters") assert.equal(await section.locator("h3").count(), expected.length);
      if (!expected.length) await section.getByText("本批试卷暂无已确认命中的知识点。").waitFor();
    }
    await page.unroute("**/api/course/analysis");
  }
  console.log("PASS mixed hits, zero hits and no papers in both views");
} finally {
  await browser.close();
}
