import assert from "node:assert/strict";

// Observe the task returned by this click before accepting a snapshot as its publication.
export async function waitForPublication(page) {
  const admission = await page.waitForResponse(r =>
    r.request().method() === "POST" && r.url().endsWith("/analysis-tasks"), { timeout: 150000 });
  assert.equal(admission.status(), 202, await admission.text());
  const task = await admission.json();
  const course = admission.url().split("/jobs/")[0];
  const terminal = await page.waitForResponse(async r => {
    if (!r.ok() || ![course + "/analysis-tasks/" + task.id, admission.url()].includes(r.url())
        || r.request().method() !== "GET" || r.status() !== 200) return false;
    const state = await r.json();
    return state.id === task.id && ["failed", "published"].includes(state.state);
  }, { timeout: 180000 });
  const state = await terminal.json();
  assert.equal(state.state, "published", state.reason);
  const response = await page.request.get(course + "/analysis");
  assert.equal((await response.json()).version, state.version);
  await page.locator(".version-plaque").getByText("版本 #" + state.version.slice(0,4), {exact:false}).waitFor();
  return response;
}
