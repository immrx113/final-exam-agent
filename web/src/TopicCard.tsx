import { ROLES, type ActiveEvidence, type SourceRef, type Topic } from "./types";

export function resolveFileId(source: SourceRef): string {
  if (source.file) return source.file;
  const match = /\/api\/course\/jobs\/[^/]+\/([^/]+)\/preview\//.exec(source.url);
  return match ? match[1] : "";
}

export function ExternalIcon() {
  return (
    <svg
      className="ext-icon"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M4.5 2.5h5v5M9.2 2.8L3 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type TopicCardProps = {
  row: Topic;
  paperCount: number;
  sources: Record<string, SourceRef>;
  controlled?: boolean;
  open?: boolean;
  onToggle?: (topicId: string, open: boolean) => void;
  activeKey: string | null;
  lastViewedKey: string | null;
  onOpenEvidence: (
    evidence: ActiveEvidence,
    trigger: HTMLButtonElement,
  ) => void;
  onMarkViewed: (key: string) => void;
};

export function TopicCard({
  row,
  paperCount,
  sources,
  controlled = true,
  open = false,
  onToggle,
  activeKey,
  lastViewedKey,
  onOpenEvidence,
  onMarkViewed,
}: TopicCardProps) {
  const summaryStats = paperCount
    ? `${row.count} 题 · ${row.papers}/${paperCount} 份卷`
    : "暂无试卷统计";

  const teachingEntries = row.topic.refs
    .map((refId) => {
      const source = sources[refId];
      return source ? { refId, source } : null;
    })
    .filter((entry): entry is { refId: string; source: SourceRef } =>
      Boolean(entry),
    );

  function buildEvidence(
    key: string,
    contextLabel: string,
    source: SourceRef,
  ): ActiveEvidence {
    return {
      key,
      topicId: row.id,
      topicName: row.topic.name,
      contextLabel,
      fileId: resolveFileId(source),
      fileName: source.name,
      locLabel: source.label,
      url: source.url,
      review: Boolean(source.review),
    };
  }

  function renderEvidenceActions(
    key: string,
    contextLabel: string,
    source: SourceRef,
  ) {
    const isCurrent = activeKey === key;
    const isRecent = !isCurrent && lastViewedKey === key;
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
          onClick={() => onMarkViewed(key)}
        >
          {source.name} · {source.label}
          <ExternalIcon />
        </a>
        <button
          type="button"
          className={isCurrent ? "sub evidence-btn is-active" : "sub evidence-btn"}
          data-evidence-key={key}
          aria-pressed={isCurrent}
          onClick={(e) =>
            onOpenEvidence(buildEvidence(key, contextLabel, source), e.currentTarget)
          }
        >
          页内对照
        </button>
        {isCurrent && <span className="evidence-status is-current">对照中</span>}
        {isRecent && <span className="evidence-status is-recent">刚查看</span>}
      </span>
    );
  }

  const cardHasActive =
    activeKey !== null && activeKey.startsWith(`${row.id}:`);

  return (
    <details
      className={cardHasActive ? "topic has-active-evidence" : "topic"}
      {...(controlled
        ? {
            open,
            onToggle: (e) => onToggle?.(row.id, e.currentTarget.open),
          }
        : {})}
    >
      <summary>
        <strong>{row.topic.name}</strong>
        <span className="topic-stats"> · {summaryStats}</span>
      </summary>

      <div className="topic-body">
        <p className="topic-chapter-line">章节：{row.topic.chapter}</p>
        <p className="topic-prose">{row.topic.text}</p>

        {teachingEntries.length > 0 && (
          <div className="topic-group">
            <div className="topic-group-label">教学出处</div>
            <div className="teaching-list">
              {teachingEntries.map(({ refId, source }) => {
                const roleKey = source.role ?? "material";
                const roleLabel = ROLES[roleKey] ?? "资料";
                const key = `${row.id}:teach:${refId}`;
                return (
                  <div className="teaching-item" key={refId}>
                    <span className={`source-role-badge role-${roleKey}`}>
                      {roleLabel}
                    </span>
                    {renderEvidenceActions(key, `${roleLabel}出处`, source)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {row.questions.length > 0 && (
          <div className="topic-group">
            <div className="topic-group-label">真题依据</div>
            <ol className="topic-questions">
              {row.questions.map((q) => {
                const qRefs = q.refs
                  .map((refId) => {
                    const source = sources[refId];
                    return source ? { refId, source } : null;
                  })
                  .filter(
                    (entry): entry is { refId: string; source: SourceRef } =>
                      Boolean(entry),
                  );
                const liHasCurrent = qRefs.some(
                  ({ refId }) =>
                    activeKey === `${row.id}:q:${q.label}:${refId}`,
                );
                const liHasRecent =
                  !liHasCurrent &&
                  qRefs.some(
                    ({ refId }) =>
                      lastViewedKey === `${row.id}:q:${q.label}:${refId}`,
                  );
                return (
                  <li
                    key={(q.refs[0] ?? "") + q.label}
                    className={
                      liHasCurrent
                        ? "question-item is-current"
                        : liHasRecent
                          ? "question-item is-recent"
                          : "question-item"
                    }
                  >
                    <span className="question-label">第 {q.label} 题</span>
                    <span className="question-refs">
                      {qRefs.map(({ refId, source }) =>
                        renderEvidenceActions(
                          `${row.id}:q:${q.label}:${refId}`,
                          `第 ${q.label} 题`,
                          source,
                        ),
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </details>
  );
}
