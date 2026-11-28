import { useCourseBase } from "./api";
import React, { useState } from "react";
import { courseApi, errorMessage } from "./api";
import {
  ITEM_STATUS_LABELS,
  ROLES,
  formatBatchLabel,
  type BatchItem,
  type DraftFile,
  type Role,
  type SavedFile,
  type SegmentSource,
} from "./types";

const ROLE_HINTS: Record<Role, string> = {
  courseware: "课堂幻灯片，提取章节骨架与概念",
  material: "讲义与复习提纲，补充知识点说明",
  exam: "历年期末真题，统计命中题数与覆盖卷数",
};

const ACCEPT_EXTENSIONS = ".ppt,.pptx,.doc,.docx,.md,.pdf,.png,.jpg,.jpeg";

function EvidenceSegments({ job, item }: { job: string; item: BatchItem }) {
  const base = useCourseBase();
  const [sources, setSources] = useState<SegmentSource[] | null>(null);
  const [error, setError] = useState("");

  async function toggle() {
    if (sources) {
      setSources(null);
      return;
    }
    try {
      const data = await courseApi<SegmentSource[]>(base,
        `jobs/${job}/${item.file}/segments`,
      );
      setSources(data);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <button type="button" className="sub" onClick={() => void toggle()}>
        {sources ? "收起片段" : "查看文本与来源"}
      </button>
      {error && <p role="alert">{error}</p>}
      {sources && (
        <div className="segment-list">
          {sources.map((s) => (
            <section className="source" key={s.id}>
              <div className="source-head">
                <a href={s.url} target="_blank" rel="noreferrer">
                  {item.name} · {s.label} ↗
                </a>
                {s.review && <strong className="review-flag">待核对</strong>}
              </div>
              <pre>{s.body || "未取得可读文本，请打开原页核对。"}</pre>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export type ImportWorkspaceProps = {
  draft: DraftFile[];
  saved: SavedFile[];
  picked: string[];
  jobs: string[];
  selectedJob: string;
  items: BatchItem[];
  publishedJob: string | null;
  hasPublished: boolean;
  submitting: boolean;
  importError: string;
  pollError: string;
  analyzing: boolean;
  analyzeLabel: string;
  taskStatus?: string;
  analysisError: string;
  canAnalyze: boolean;
  onAddDrafts: (role: Role, files: File[]) => void;
  onChangeDraftRole: (key: string, role: Role) => void;
  onRemoveDraft: (key: string) => void;
  onTogglePicked: (fileId: string, checked: boolean) => void;
  onSubmit: () => void;
  onReloadCourse: () => void;
  onSelectJob: (jobId: string) => void;
  onRetryFile: (fileId: string, action?: "retry" | "recheck") => void;
  onAnalyze: () => void;
  onLoadLatestAnalysis: () => void;
};

export function ImportWorkspace({
  draft,
  saved,
  picked,
  jobs,
  selectedJob,
  items,
  publishedJob,
  hasPublished,
  submitting,
  importError,
  pollError,
  analyzing,
  analyzeLabel,
  taskStatus,
  analysisError,
  canAnalyze,
  onAddDrafts,
  onChangeDraftRole,
  onRemoveDraft,
  onTogglePicked,
  onSubmit,
  onReloadCourse,
  onSelectJob,
  onRetryFile,
  onAnalyze,
  onLoadLatestAnalysis,
}: ImportWorkspaceProps) {
  const base = useCourseBase();
  const [manualOpen, setManualOpen] = useState(false);
  const expanded = !hasPublished || draft.length > 0 || manualOpen;

  const selectedBatchLabel = formatBatchLabel(jobs, selectedJob);
  const publishedBatchLabel = publishedJob
    ? formatBatchLabel(jobs, publishedJob)
    : "";
  const isSelectedPublished =
    Boolean(publishedJob) && selectedJob === publishedJob;
  const readyCount = items.filter((i) => i.status === "ready").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const allSettled =
    items.length > 0 &&
    items.every((i) => i.status === "ready" || i.status === "failed");

  function handleFileInput(
    role: Role,
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      onAddDrafts(role, files);
    }
    event.target.value = "";
  }

  const savedDrawer = saved.length > 0 && (
    <details className="saved-files">
      <summary>已上传文件（{saved.length}）</summary>
      <div className="saved-list">
        {saved.map((f) => (
          <div className="saved-row" key={f.id}>
            <label className="saved-check">
              <input
                type="checkbox"
                checked={picked.includes(f.id)}
                onChange={(e) => onTogglePicked(f.id, e.target.checked)}
              />
              <span className="role-tag">{ROLES[f.role]}</span>
              <span className="file-name">{f.name}</span>
            </label>
            <a href={`${base}/files/${f.id}/original`}>下载原件</a>
          </div>
        ))}
      </div>
    </details>
  );

  return (
    <div className="workspace-stack">
      {!hasPublished && jobs.length === 0 && (
        <ol className="step-strip" aria-label="复习准备步骤">
          <li>
            <strong>第 1 步</strong> 导入课件、资料和历年试卷
          </li>
          <li>
            <strong>第 2 步</strong> 核对解析文本与存疑页
          </li>
          <li>
            <strong>第 3 步</strong> 生成真题频次重点与复习计划
          </li>
        </ol>
      )}

      {expanded ? (
        <section className="import-card" aria-label="导入课程资料">
          <div className="import-head">
            <div>
              <h2>导入文件</h2>
              <p className="hint">
                按用途选择文件，可在提交前调整归类。支持 PDF、PPT/PPTX、DOC/DOCX、Markdown、JPG
                和 PNG，单文件不超过 50 MB。
              </p>
            </div>
            {hasPublished && draft.length === 0 && (
              <button
                type="button"
                className="sub"
                onClick={() => setManualOpen(false)}
              >
                收起导入面板
              </button>
            )}
          </div>

          <fieldset disabled={submitting}>
            <div className="zones">
              {(Object.keys(ROLES) as Role[]).map((role) => {
                const roleDrafts = draft.filter((f) => f.role === role);
                return (
                  <section className="zone" key={role}>
                    <div className="zone-head">
                      <h3>{ROLES[role]}</h3>
                      <p className="zone-hint">{ROLE_HINTS[role]}</p>
                    </div>
                    <label className="picker">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 14 14"
                        aria-hidden="true"
                      >
                        <path
                          d="M7 2v10M2 7h10"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                      {"选择" + ROLES[role]}
                      <input
                        type="file"
                        multiple
                        accept={ACCEPT_EXTENSIONS}
                        onChange={(e) => handleFileInput(role, e)}
                      />
                    </label>
                    {roleDrafts.map((f) => (
                      <div className="draft" key={f.key}>
                        <b className="file-name">{f.file.name}</b>
                        <div className="draft-actions">
                          <select
                            aria-label={`${f.file.name}的用途`}
                            value={f.role}
                            onChange={(e) =>
                              onChangeDraftRole(f.key, e.target.value as Role)
                            }
                          >
                            {Object.entries(ROLES).map(([r, label]) => (
                              <option key={r} value={r}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="sub"
                            onClick={() => onRemoveDraft(f.key)}
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>

            <div className="import-footer">
              <div className="import-footer-saved">{savedDrawer}</div>
              <button
                type="button"
                className="primary"
                disabled={!draft.length && !picked.length}
                onClick={() => {
                  setManualOpen(false);
                  onSubmit();
                }}
              >
                {submitting ? "正在提交…" : "提交处理"}
              </button>
            </div>
          </fieldset>
        </section>
      ) : (
        <section className="quick-import-bar" aria-label="快捷导入课程资料">
          <fieldset disabled={submitting} className="quick-import-fieldset">
            <div className="quick-import-row">
              <span className="quick-import-label">追加或复用资料</span>
              <div className="quick-pickers">
                {(Object.keys(ROLES) as Role[]).map((role) => (
                  <label className="picker picker-compact" key={role}>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 14 14"
                      aria-hidden="true"
                    >
                      <path
                        d="M7 2v10M2 7h10"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                    {"选择" + ROLES[role]}
                    <input
                      type="file"
                      multiple
                      accept={ACCEPT_EXTENSIONS}
                      onChange={(e) => handleFileInput(role, e)}
                    />
                  </label>
                ))}
              </div>
              <div className="quick-actions">
                <button
                  type="button"
                  className="sub"
                  onClick={() => setManualOpen(true)}
                >
                  展开三栏说明
                </button>
                <button
                  type="button"
                  className="primary primary-compact"
                  disabled={!draft.length && !picked.length}
                  onClick={onSubmit}
                >
                  {submitting ? "正在提交…" : "提交处理"}
                </button>
              </div>
            </div>
            {savedDrawer}
          </fieldset>
        </section>
      )}

      {importError && (
        <p role="alert" className="alert-banner">
          <span>{importError}</span>{" "}
          <button type="button" className="sub" onClick={onReloadCourse}>
            刷新课程
          </button>
        </p>
      )}

      {jobs.length > 0 && (
        <section
          className={`batch-workspace ${
            !isSelectedPublished || analyzing || Boolean(analysisError)
              ? "is-pending"
              : "is-published"
          }`}
          aria-label="当前批次工作区"
        >
          <div className="batch-bar">
            <div className="batch-summary">
              <h2>
                {isSelectedPublished
                  ? `批次文件 · ${selectedBatchLabel}`
                  : `正在处理 · ${selectedBatchLabel}`}
              </h2>
              <span className="batch-progress">
                {items.length === 0
                  ? "正在读取批次列表…"
                  : allSettled
                    ? failedCount > 0
                      ? `共 ${items.length} 份文件 · 已完成 ${readyCount} 份，失败 ${failedCount} 份`
                      : `共 ${items.length} 份文件 · 已全部解析完成`
                    : `共 ${items.length} 份文件 · 已完成 ${readyCount}/${items.length}`}
              </span>
            </div>

            <div className="batch-controls">
              <label className="batch-select-label">
                <span>处理批次</span>
                <select
                  aria-label="处理批次"
                  value={selectedJob}
                  onChange={(e) => onSelectJob(e.target.value)}
                >
                  {jobs.map((j, i) => {
                    const label = `第 ${jobs.length - i} 批`;
                    const stateText = publishedJob
                      ? j === publishedJob
                        ? "（已发布）"
                        : "（待发布）"
                      : "";
                    return (
                      <option value={j} key={j}>
                        {label}
                        {stateText}
                      </option>
                    );
                  })}
                </select>
              </label>

              <button
                type="button"
                className="primary batch-analyze-btn"
                disabled={!canAnalyze || analyzing}
                onClick={onAnalyze}
              >
                {analyzing ? "正在读取或分析…" : analyzeLabel}
              </button>
            </div>
          </div>

          {taskStatus && <p role="status" className="hint">{taskStatus}</p>}

          {hasPublished && !isSelectedPublished && publishedBatchLabel && (
            <p className="batch-preserve-note">
              新批次发布完成前，下方继续保留【{publishedBatchLabel}】已发布结果，你的查看视角、笔记保存与
              Markdown 导出不受影响。
            </p>
          )}

          {pollError && (
            <p role="alert" className="alert-inline">
              {pollError}，正在重新连接
            </p>
          )}

          {analysisError && (
            <p role="alert" className="alert-inline">
              <span>{analysisError}</span>{" "}
              <button
                type="button"
                className="sub"
                onClick={onLoadLatestAnalysis}
              >
                读取上次结果
              </button>
            </p>
          )}

          {items.length > 0 && (
            <div className="batch-files">
              {items.map((item) => (
                <article className="batch-file" key={selectedJob + item.file}>
                  <div className="batch-file-row">
                    <div className="batch-file-meta">
                      <b className="file-name">{item.name}</b>
                      <span className={`status-pill status-${item.status}`}>
                        {ROLES[item.role]} · {ITEM_STATUS_LABELS[item.status]}
                        {item.status === "ready" && item.parseOrigin &&
                          (item.parseOrigin === "reused" ? " · 复用已有解析" : " · 本次解析")}
                      </span>
                    </div>
                    <div className="batch-file-actions">
                      <a href={`${base}/files/${item.file}/original`}>
                        下载原件
                      </a>
                      {item.status === "ready" && (
                        <>
                          <EvidenceSegments job={selectedJob} item={item} />
                          {/\.(pdf|pptx?|docx?)$/i.test(item.name) && (
                            <button
                              type="button"
                              className="sub"
                              onClick={() => onRetryFile(item.file, "recheck")}
                            >
                              重新识别正文
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {item.status === "failed" && (
                    <p className="file-error">
                      <span>{item.reason}</span>{" "}
                      <button
                        type="button"
                        onClick={() => onRetryFile(item.file, "retry")}
                      >
                        重试此文件
                      </button>
                    </p>
                  )}
                  {item.status === "ready" && item.reason && (
                    <p role="alert" className="alert-inline">
                      {item.reason}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
