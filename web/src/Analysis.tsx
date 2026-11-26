import { useState } from "react";
import { Study } from "./Study";
import type { Snapshot, Topic, ViewMode } from "./types";

export type { Topic } from "./types";

export type AnalysisProps = {
  snapshot: Snapshot | null;
  hasJobs: boolean;
  initialLoading: boolean;
  selectedJob: string;
  publishedBatchLabel: string;
  onSelectPublishedJob: () => void;
};

export function Analysis({
  snapshot,
  hasJobs,
  initialLoading,
  selectedJob,
  publishedBatchLabel,
  onSelectPublishedJob,
}: AnalysisProps) {
  const [view, setView] = useState<ViewMode>("rank");
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(
    () => new Set(),
  );

  function toggleTopic(id: string, open: boolean) {
    setExpandedTopics((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function renderLinks(refs: string[]) {
    if (!snapshot) return null;
    return refs.map((id) => {
      const s = snapshot.sources[id];
      if (!s) return null;
      return (
        <a
          className="evidence-link"
          key={id}
          href={s.url}
          target="_blank"
          rel="noreferrer"
        >
          {s.name} · {s.label}
        </a>
      );
    });
  }

  function renderDetail(row: Topic, controlled = true) {
    if (!snapshot) return null;
    const summaryStats = snapshot.paperCount
      ? `${row.count} 题 · ${row.papers}/${snapshot.paperCount} 份卷`
      : "暂无试卷统计";
    return (
      <details
        key={row.id}
        className="topic"
        {...(controlled
          ? {
              open: expandedTopics.has(row.id),
              onToggle: (e) => toggleTopic(row.id, e.currentTarget.open),
            }
          : {})}
      >
        <summary>
          <strong>{row.topic.name}</strong>
          <span className="topic-stats"> · {summaryStats}</span>
        </summary>
        <p className="topic-prose">
          {row.topic.chapter} · {row.topic.text}
        </p>
        {row.topic.refs.length > 0 && (
          <div className="topic-teaching">
            教学出处 {renderLinks(row.topic.refs)}
          </div>
        )}
        {row.questions.length > 0 && (
          <ol className="topic-questions">
            {row.questions.map((q) => (
              <li key={q.refs[0] + q.label}>
                第 {q.label} 题 {renderLinks(q.refs)}
              </li>
            ))}
          </ol>
        )}
      </details>
    );
  }

  if (!snapshot) {
    return (
      <section className="analysis-section" aria-label="课程分析">
        <div className="section-head">
          <h2>课程分析</h2>
        </div>
        {initialLoading ? (
          <p className="hint">正在读取已发布课程分析…</p>
        ) : hasJobs ? (
          <p className="empty-state">请先分析本批资料，生成复习计划和待办。</p>
        ) : (
          <p className="empty-state">
            尚未导入并分析材料。提交文件完成解析后，即可在此按真题频次查看考点、核对原页并制定复习计划。
          </p>
        )}
      </section>
    );
  }

  const visible = snapshot.paperCount
    ? snapshot.ranked.filter((row) => row.count > 0)
    : snapshot.ranked;
  const hiddenZeroCount = snapshot.paperCount
    ? snapshot.ranked.length - visible.length
    : 0;
  const outline = [...visible].sort(
    (a, b) => (a.outlineOrder ?? 0) - (b.outlineOrder ?? 0),
  );
  const topicsById = new Map(visible.map((r) => [r.id, r]));
  const plan =
    snapshot.plan ??
    visible.map((r) => ({
      topic: r.id,
      reason: snapshot.paperCount
        ? `按真题频次安排，命中 ${r.count} 题。`
        : "暂无试卷统计，按课程章节顺序学习。",
      ref: undefined,
    }));

  const shortVersion = snapshot.version.slice(0, 4);
  const isViewingPublishedJob = !selectedJob || snapshot.job === selectedJob;
  const paperSummary = snapshot.paperCount
    ? `纳入 ${snapshot.paperCount} 份试卷`
    : "暂无试卷统计";

  return (
    <section className="analysis-section" aria-label="课程分析">
      <div className="section-head">
        <h2>课程分析</h2>
      </div>

      <div className="version-plaque">
        <div className="plaque-main">
          <span className="plaque-badge">
            {isViewingPublishedJob
              ? `当前已发布 · ${publishedBatchLabel}`
              : `当前阅读仍是：${publishedBatchLabel}已发布结果`}
          </span>
          <span className="plaque-meta">
            版本 #{shortVersion} · {visible.length} 个知识点 · {paperSummary}
          </span>
          {hiddenZeroCount > 0 && (
            <span className="plaque-note">
              已隐藏 {hiddenZeroCount} 个未考知识点（已存笔记保留在库中）
            </span>
          )}
        </div>
        {!isViewingPublishedJob && (
          <button
            type="button"
            className="sub plaque-switch"
            onClick={onSelectPublishedJob}
          >
            切回查看{publishedBatchLabel}文件
          </button>
        )}
      </div>

      <div className="analysis-toolbar">
        <label className="view-picker">
          <span>查看方式</span>
          <select
            value={view}
            onChange={(e) => setView(e.target.value as ViewMode)}
          >
            <option value="rank">真题频次</option>
            <option value="chapters">章节目录</option>
            <option value="plan">参考计划</option>
            <option value="study">复习待办</option>
          </select>
        </label>

        {snapshot.paperCount > 0 && visible.length > 0 ? (
          <div className="export-bar">
            <a
              className="export-link"
              href={`/api/course/versions/${snapshot.version}/export`}
              download
            >
              下载 Markdown 复习文档
            </a>
            <span className="export-meta">
              对应 {publishedBatchLabel}（版本 #{shortVersion}，仅含正命中考点，不含笔记）
            </span>
          </div>
        ) : (
          <p className="hint export-empty">
            {snapshot.paperCount
              ? "暂无已确认命中的知识点可导出"
              : "暂无有效试卷可供导出"}
          </p>
        )}
      </div>

      {view === "plan" && (
        <ol className="plan-list">
          {plan.map((s) => (
            <li key={s.topic}>
              <strong>{topicsById.get(s.topic)?.topic.name}</strong> · {s.reason}{" "}
              {s.ref && renderLinks([s.ref])}
            </li>
          ))}
        </ol>
      )}

      {view === "study" && (
        <Study
          key={snapshot.version}
          version={snapshot.version}
          rows={visible}
          detail={(row) => renderDetail(row, false)}
        />
      )}

      {view === "rank" && (
        <div className="topic-list">
          {visible.map((row) => renderDetail(row, true))}
        </div>
      )}

      {view === "chapters" &&
        Array.from(new Set(outline.map((r) => r.topic.chapter))).map(
          (chapter) => (
            <section className="chapter-group" key={chapter}>
              <h3>{chapter}</h3>
              {outline
                .filter((r) => r.topic.chapter === chapter)
                .map((row) => renderDetail(row, true))}
            </section>
          ),
        )}

      {!visible.length && (
        <p className="empty-state">
          {snapshot.paperCount
            ? "本批试卷暂无已确认命中的知识点。"
            : "未提取到有依据的知识点。"}
        </p>
      )}

      {snapshot.reviews.length > 0 && (
        <details className="reviews-box">
          <summary>待核对（{snapshot.reviews.length}）</summary>
          <ul>
            {snapshot.reviews.map((r, i) => (
              <li key={i}>
                {r.reason} {renderLinks(r.refs)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
