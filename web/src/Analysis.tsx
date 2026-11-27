import { useCourseBase } from "./api";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { Study } from "./Study";
import { ExternalIcon, TopicCard, resolveFileId } from "./TopicCard";
import type {
  ActiveEvidence,
  Snapshot,
  StudyState,
  Topic,
  ViewMode,
} from "./types";

export type { Topic } from "./types";

const VIEW_ORDER: ViewMode[] = ["rank", "chapters", "plan", "study"];

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
  const base = useCourseBase();
  const [view, setView] = useState<ViewMode>("rank");
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedPlanSteps, setExpandedPlanSteps] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeEvidence, setActiveEvidence] = useState<ActiveEvidence | null>(
    null,
  );
  const [lastViewedKey, setLastViewedKey] = useState<string | null>(null);

  const [studyStates, setStudyStates] = useState<Map<
    string,
    StudyState
  > | null>(null);
  const [studyFailed, setStudyFailed] = useState(false);
  const [studyAttempt, setStudyAttempt] = useState(0);
  const [studyDrafts, setStudyDrafts] = useState<Record<string, string>>({});
  const [studyConflicts, setStudyConflicts] = useState<Record<string, boolean>>(
    {},
  );
  const [pendingFocusTopicId, setPendingFocusTopicId] = useState<string | null>(
    null,
  );

  const triggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusKeyRef = useRef<string | null>(null);
  const tabRefs = useRef<Record<ViewMode, HTMLButtonElement | null>>({
    rank: null,
    chapters: null,
    plan: null,
    study: null,
  });

  const version = snapshot?.version ?? "";

  useEffect(() => {
    restoreFocusKeyRef.current = null;
    triggerBtnRef.current = null;
    setActiveEvidence(null);
    setLastViewedKey(null);
    setExpandedPlanSteps(new Set());
    setStudyStates(null);
    setStudyFailed(false);
    setStudyDrafts({});
    setStudyConflicts({});
    setPendingFocusTopicId(null);
  }, [version]);

  useEffect(() => {
    if (!version) return;
    let active = true;
    setStudyFailed(false);
    fetch(`${base}/versions/${version}/states`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as StudyState[];
        if (active) {
          setStudyStates(new Map(data.map((s) => [s.topic, s])));
        }
      })
      .catch(() => {
        if (active) setStudyFailed(true);
      });
    return () => {
      active = false;
    };
  }, [version, studyAttempt]);

  useEffect(() => {
    if (view !== "study" || !pendingFocusTopicId) return;
    if (!studyStates && !studyFailed) return;
    const targetId = pendingFocusTopicId;
    setPendingFocusTopicId(null);
    const textarea = document.getElementById(
      "note-" + targetId,
    ) as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.scrollIntoView({ block: "nearest" });
      textarea.focus({ preventScroll: true });
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    }
  }, [view, pendingFocusTopicId, studyStates, studyFailed]);

  useLayoutEffect(() => {
    if (activeEvidence !== null || !restoreFocusKeyRef.current) return;
    const key = restoreFocusKeyRef.current;
    restoreFocusKeyRef.current = null;
    const directBtn = triggerBtnRef.current;
    if (directBtn && directBtn.isConnected) {
      directBtn.focus();
      return;
    }
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button[data-evidence-key]"),
    );
    for (const btn of buttons) {
      if (btn.dataset.evidenceKey === key) {
        btn.focus();
        break;
      }
    }
  }, [activeEvidence]);

  function toggleTopic(id: string, open: boolean) {
    setExpandedTopics((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePlanStep(id: string, forceOpen?: boolean) {
    setExpandedPlanSteps((prev) => {
      const nextOpen = forceOpen ?? !prev.has(id);
      if (prev.has(id) === nextOpen) return prev;
      const next = new Set(prev);
      if (nextOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleStudyStateChange(nextState: StudyState) {
    setStudyStates((prev) => {
      const next = new Map(prev ?? []);
      next.set(nextState.topic, nextState);
      return next;
    });
  }

  function handleDraftChange(topicId: string, value: string) {
    setStudyDrafts((prev) => ({ ...prev, [topicId]: value }));
  }

  function handleClearDraft(topicId: string) {
    setStudyDrafts((prev) => {
      if (!(topicId in prev)) return prev;
      const next = { ...prev };
      delete next[topicId];
      return next;
    });
  }

  function handleConflictChange(topicId: string, value: boolean) {
    setStudyConflicts((prev) => {
      if (Boolean(prev[topicId]) === value) return prev;
      const next = { ...prev };
      if (value) next[topicId] = true;
      else delete next[topicId];
      return next;
    });
  }

  function handleTabKeyDown(
    e: KeyboardEvent<HTMLButtonElement>,
    current: ViewMode,
  ) {
    const idx = VIEW_ORDER.indexOf(current);
    let nextIdx = -1;
    if (e.key === "ArrowRight") {
      nextIdx = (idx + 1) % VIEW_ORDER.length;
    } else if (e.key === "ArrowLeft") {
      nextIdx = (idx + VIEW_ORDER.length - 1) % VIEW_ORDER.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = VIEW_ORDER.length - 1;
    }
    if (nextIdx >= 0) {
      e.preventDefault();
      const nextMode = VIEW_ORDER[nextIdx];
      setView(nextMode);
      tabRefs.current[nextMode]?.focus();
    }
  }

  function handleJumpToStudyNote(topicId: string) {
    setPendingFocusTopicId(topicId);
    setView("study");
  }

  function handleOpenEvidence(
    evidence: ActiveEvidence,
    trigger: HTMLButtonElement,
  ) {
    triggerBtnRef.current = trigger;
    restoreFocusKeyRef.current = null;
    setActiveEvidence(evidence);
    setLastViewedKey(evidence.key);
    if (evidence.topicId && !evidence.topicId.startsWith("__")) {
      toggleTopic(evidence.topicId, true);
    }
  }

  function handleCloseEvidence() {
    if (activeEvidence) {
      restoreFocusKeyRef.current = activeEvidence.key;
    }
    setActiveEvidence(null);
  }

  function handleMarkViewed(key: string) {
    setLastViewedKey(key);
  }

  function renderInlineEvidence(
    refId: string,
    key: string,
    topicId: string,
    topicName: string,
    contextLabel: string,
  ) {
    if (!snapshot) return null;
    const source = snapshot.sources[refId];
    if (!source) return null;
    const isCurrent = activeEvidence?.key === key;
    const isRecent = !isCurrent && lastViewedKey === key;
    const payload: ActiveEvidence = {
      key,
      topicId,
      topicName,
      contextLabel,
      fileId: resolveFileId(source),
      fileName: source.name,
      locLabel: source.label,
      url: source.url,
      review: Boolean(source.review),
    };
    return (
      <span
        key={key}
        className={
          isCurrent
            ? "evidence-entry is-current"
            : isRecent
              ? "evidence-entry is-recent"
              : "evidence-entry"
        }
      >
        <a
          className="evidence-link"
          href={source.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => handleMarkViewed(key)}
        >
          {source.name} · {source.label}
          <ExternalIcon />
        </a>
        <button
          type="button"
          className={
            isCurrent ? "sub evidence-btn is-active" : "sub evidence-btn"
          }
          data-evidence-key={key}
          aria-pressed={isCurrent}
          onClick={(e) => handleOpenEvidence(payload, e.currentTarget)}
        >
          页内对照
        </button>
        {isCurrent && <span className="evidence-status is-current">对照中</span>}
        {isRecent && <span className="evidence-status is-recent">刚查看</span>}
      </span>
    );
  }

  function renderTopicCard(row: Topic, controlled = true) {
    if (!snapshot) return null;
    return (
      <TopicCard
        key={row.id}
        row={row}
        paperCount={snapshot.paperCount}
        sources={snapshot.sources}
        controlled={controlled}
        open={expandedTopics.has(row.id)}
        onToggle={toggleTopic}
        activeKey={activeEvidence?.key ?? null}
        lastViewedKey={lastViewedKey}
        onOpenEvidence={handleOpenEvidence}
        onMarkViewed={handleMarkViewed}
      />
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
          <div className="empty-state">
            <p className="empty-state-title">
              请先分析本批资料，生成复习计划和待办。
            </p>
            <p className="empty-state-guide">
              可在上方当前批次工作区点击“查看文本与来源”核对解析片段（识别存疑可点“重新识别正文”，失败文件可点“重试此文件”），就绪后点击“分析本批资料”。
            </p>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-state-title">尚未导入并分析材料。</p>
            <p className="empty-state-guide">
              请先在上方按课件、资料、试卷选择文件并点击“提交处理”。完成解析并发布分析后，即可在此按真题频次查看考点、页内对照原页并制定复习计划。
            </p>
          </div>
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
  const chapters = Array.from(new Set(outline.map((r) => r.topic.chapter)));
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

  const completedCount = studyStates
    ? visible.reduce(
        (acc, row) => acc + (studyStates.get(row.id)?.completed ? 1 : 0),
        0,
      )
    : null;

  const shortVersion = snapshot.version.slice(0, 4);
  const isViewingPublishedJob = !selectedJob || snapshot.job === selectedJob;
  const paperSummary = snapshot.paperCount
    ? `纳入 ${snapshot.paperCount} 份试卷`
    : "暂无试卷统计";

  const tabMeta: {
    mode: ViewMode;
    label: string;
    badge: string | null;
  }[] = [
    {
      mode: "rank",
      label: "真题频次",
      badge: String(visible.length),
    },
    {
      mode: "chapters",
      label: "章节目录",
      badge: chapters.length > 0 ? `${chapters.length} 章` : null,
    },
    {
      mode: "plan",
      label: "参考计划",
      badge: plan.length > 0 ? `${plan.length} 步` : null,
    },
    {
      mode: "study",
      label: "复习待办",
      badge:
        completedCount !== null && visible.length > 0
          ? `已完成 ${completedCount}/${visible.length}`
          : null,
    },
  ];

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

      <div className="export-strip">
        {snapshot.paperCount > 0 && visible.length > 0 ? (
          <div className="export-bar">
            <a
              className="export-link"
              href={`${base}/versions/${snapshot.version}/export`}
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

      <div className="view-tabs" role="tablist" aria-label="查看方式">
        {tabMeta.map(({ mode, label, badge }) => {
          const selected = view === mode;
          return (
            <button
              key={mode}
              ref={(el) => {
                tabRefs.current[mode] = el;
              }}
              id={`tab-${mode}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${mode}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? "view-tab is-active" : "view-tab"}
              onClick={() => setView(mode)}
              onKeyDown={(e) => handleTabKeyDown(e, mode)}
            >
              <span>{label}</span>
              {badge !== null && <span className="tab-badge">{badge}</span>}
            </button>
          );
        })}
      </div>

      <div
        className={
          activeEvidence ? "analysis-body has-drawer" : "analysis-body"
        }
      >
        <div className="analysis-primary">
          <div
            id={`panel-${view}`}
            role="tabpanel"
            aria-labelledby={`tab-${view}`}
            className="tab-panel"
          >
            {view === "plan" && plan.length > 0 && (
              <ol className="plan-list">
                {plan.map((s) => {
                  const row = topicsById.get(s.topic);
                  const topicName = row?.topic.name ?? "参考计划";
                  const isPlanExpanded = expandedPlanSteps.has(s.topic);
                  const stepState = studyStates?.get(s.topic);
                  const hasNote = Boolean(
                    (studyDrafts[s.topic] ?? stepState?.note ?? "").trim(),
                  );
                  return (
                    <li key={s.topic} className="plan-step">
                      <div className="plan-step-main">
                        <div className="plan-step-text">
                          <strong>{topicName}</strong>
                          {stepState?.completed && (
                            <span className="plan-status-pill is-done">
                              已完成
                            </span>
                          )}
                          {hasNote && (
                            <span className="plan-status-pill">含笔记</span>
                          )}
                          <span> · {s.reason} </span>
                          {s.ref &&
                            renderInlineEvidence(
                              s.ref,
                              `plan:${s.topic}:${s.ref}`,
                              s.topic,
                              topicName,
                              "先后依据",
                            )}
                        </div>
                        {row && (
                          <div className="plan-step-actions">
                            <button
                              type="button"
                              className="sub plan-action-btn"
                              aria-expanded={isPlanExpanded}
                              onClick={() => togglePlanStep(s.topic)}
                            >
                              {isPlanExpanded
                                ? "收起考点与依据"
                                : "展开考点与依据"}
                            </button>
                            <button
                              type="button"
                              className="sub plan-action-btn is-jump"
                              onClick={() => handleJumpToStudyNote(s.topic)}
                            >
                              去待办记笔记
                            </button>
                          </div>
                        )}
                      </div>
                      {row && isPlanExpanded && (
                        <div className="plan-step-detail">
                          <TopicCard
                            row={row}
                            paperCount={snapshot.paperCount}
                            sources={snapshot.sources}
                            controlled={true}
                            open={true}
                            onToggle={(_, nextOpen) => {
                              if (!nextOpen) togglePlanStep(s.topic, false);
                            }}
                            activeKey={activeEvidence?.key ?? null}
                            lastViewedKey={lastViewedKey}
                            onOpenEvidence={handleOpenEvidence}
                            onMarkViewed={handleMarkViewed}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {view === "study" && (
              <Study
                key={snapshot.version}
                version={snapshot.version}
                rows={visible}
                states={studyStates}
                failed={studyFailed}
                onRetry={() => setStudyAttempt((n) => n + 1)}
                onStateChange={handleStudyStateChange}
                drafts={studyDrafts}
                onDraftChange={handleDraftChange}
                onClearDraft={handleClearDraft}
                conflicts={studyConflicts}
                onConflictChange={handleConflictChange}
                detail={(row) => renderTopicCard(row, true)}
              />
            )}

            {view === "rank" && (
              <div className="topic-list">
                {visible.map((row) => renderTopicCard(row, true))}
              </div>
            )}

            {view === "chapters" &&
              chapters.map((chapter) => (
                <section className="chapter-group" key={chapter}>
                  <h3>{chapter}</h3>
                  {outline
                    .filter((r) => r.topic.chapter === chapter)
                    .map((row) => renderTopicCard(row, true))}
                </section>
              ))}

            {!visible.length && (
              <div className="empty-state">
                {snapshot.paperCount ? (
                  <>
                    <p className="empty-state-title">
                      本批试卷暂无已确认命中的知识点。
                    </p>
                    <p className="empty-state-guide">
                      可展开下方“待核对”核查题干模糊或试卷归属未明的原页，或在上方批次文件中打开“查看文本与来源”、点击“重新识别正文”，补充对应讲义后重新分析。
                    </p>
                  </>
                ) : (
                  <>
                    <p className="empty-state-title">
                      未提取到有依据的知识点。
                    </p>
                    <p className="empty-state-guide">
                      请在上方当前批次中打开文件的“查看文本与来源”核查转换或 OCR 结果；若版面识别不完整可点击“重新识别正文”，或补充包含明确章节与定义的资料后重新分析。
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {snapshot.reviews.length > 0 && (
            <details className="reviews-box">
              <summary>待核对（{snapshot.reviews.length}）</summary>
              <ul>
                {snapshot.reviews.map((r, i) => (
                  <li key={i} className="review-row">
                    <span className="review-reason">{r.reason}</span>
                    <span className="review-refs">
                      {r.refs.map((refId) =>
                        renderInlineEvidence(
                          refId,
                          `__review:${i}:${refId}`,
                          "__review",
                          "待核对材料",
                          r.reason,
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {activeEvidence && (
          <EvidenceDrawer
            evidence={activeEvidence}
            onClose={handleCloseEvidence}
          />
        )}
      </div>
    </section>
  );
}
