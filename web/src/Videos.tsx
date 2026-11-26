import { useEffect, useState } from "react";
import { ExternalIcon } from "./TopicCard";
import type { VideoState } from "./types";

export type VideosProps = {
  version: string;
  batchLabel?: string;
};

export function Videos({ version, batchLabel }: VideosProps) {
  const [state, setState] = useState<VideoState | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const url = "/api/course/versions/" + version + "/videos";

    async function load(retry: boolean) {
      try {
        const response = await fetch(url + (retry ? "/retry" : ""), {
          signal: controller.signal,
          method: retry ? "POST" : "GET",
          headers: retry ? { "X-Review-Request": "1" } : {},
        });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as VideoState;
        if (controller.signal.aborted) return;
        setState(data);
        if (["queued", "running"].includes(data.status)) {
          timer = setTimeout(() => void load(false), 1000);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }

    void load(attempt > 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [version, attempt]);

  function handleRetry() {
    setError(false);
    setState(null);
    setAttempt((a) => a + 1);
  }

  const pending =
    !error && (!state || ["queued", "running"].includes(state.status));
  const metric = (value: number | null) =>
    value !== null ? value.toLocaleString("en-US") : "未取得";

  return (
    <section className="videos-section" aria-label="B 站参考视频">
      <div className="section-head videos-head">
        <div className="videos-title-row">
          <h2>B 站参考视频</h2>
          <span className="videos-version-pill">
            {batchLabel ? `${batchLabel} · ` : ""}版本 #{version.slice(0, 4)}
          </span>
        </div>
        <span className="videos-subhint">
          按优先复习考点匹配最多 3 条对应讲次
        </span>
      </div>

      {pending && (
        <div className="video-status-bar is-pending">
          <p className="video-status-text" role="status">
            正在检索参考视频…
          </p>
        </div>
      )}

      {!pending && (error || state?.status === "failed") && (
        <div className="video-status-bar is-failed">
          <p className="video-status-text" role="alert">
            {error
              ? "暂时无法读取推荐"
              : state?.reason || "视频检索暂时不可用，请重试。"}
          </p>
          <button
            type="button"
            className="sub video-retry-btn"
            onClick={handleRetry}
          >
            重试视频检索
          </button>
        </div>
      )}

      {!pending && !error && state?.status === "partial" && (
        <div className="video-status-bar is-partial">
          <div className="video-status-main">
            <span className="video-source-badge">
              {state.reason.includes("BV 候选目录") ? "目录后备" : "部分完成"}
            </span>
            <p className="video-status-text" role="status">
              {state.reason}
            </p>
          </div>
          <button
            type="button"
            className="sub video-retry-btn"
            onClick={handleRetry}
          >
            重试视频检索
          </button>
        </div>
      )}

      {!pending &&
        !error &&
        state?.status === "ready" &&
        state.items.length === 0 && (
          <div className="empty-state video-empty">
            <p className="empty-state-title" role="status">
              {state.reason || "暂无匹配视频"}
            </p>
            <p className="empty-state-guide">
              {state.reason === "暂无可推荐的知识点"
                ? "当前版本尚无正命中或已入计划的知识点，补充匹配试卷或教学讲义后重新分析即可自动检索。"
                : "公开检索与课程候选目录均未命中当前优先考点，章节浏览、待办记笔记与导出功能仍可正常使用。"}
            </p>
          </div>
        )}

      {!pending &&
        !error &&
        state?.status === "ready" &&
        state.items.length > 0 &&
        Boolean(state.reason) && (
          <div className="video-status-bar is-info">
            <div className="video-status-main">
              {state.reason.includes("BV 候选目录") && (
                <span className="video-source-badge">目录后备</span>
              )}
              <p className="video-status-text" role="status">
                {state.reason}
              </p>
            </div>
          </div>
        )}

      {state && state.items.length > 0 && (
        <ul className="video-list">
          {state.items.map((v) => {
            const scopeLabel =
              v.target === "合集单集" ? "单集数据" : "整条视频";
            const isDirectEpisode =
              v.target === "合集单集" || v.target === "分 P";
            return (
              <li key={v.url} className="video-card">
                <div className="video-card-head">
                  <a
                    className="video-link"
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>{v.title}</span>
                    <ExternalIcon />
                  </a>
                  <span
                    className={
                      isDirectEpisode
                        ? "video-target-badge is-direct"
                        : "video-target-badge"
                    }
                  >
                    {v.target}
                  </span>
                </div>
                <div className="video-topics">
                  对应知识点：{v.topics.join("、")}
                </div>
                <div className="video-metrics">
                  {scopeLabel} · 播放 {metric(v.views)} · 点赞 {metric(v.likes)}{" "}
                  · 收藏 {metric(v.favorites)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
