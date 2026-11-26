import { useState, type ReactNode } from "react";
import type { StudyState, Topic } from "./types";

type Fields = { completed?: boolean; note?: string };

type StudyItemProps = {
  row: Topic;
  initial?: StudyState;
  draftOverride?: string;
  conflict: boolean;
  url: string;
  onStateChange: (next: StudyState) => void;
  onDraftChange: (topicId: string, value: string) => void;
  onClearDraft: (topicId: string) => void;
  onConflictChange: (topicId: string, value: boolean) => void;
  children: ReactNode;
};

function StudyItem({
  row,
  initial,
  draftOverride,
  conflict,
  url,
  onStateChange,
  onDraftChange,
  onClearDraft,
  onConflictChange,
  children,
}: StudyItemProps) {
  const state: StudyState = initial ?? {
    topic: row.id,
    revision: 0,
    completed: false,
    note: "",
  };
  const draft = draftOverride ?? state.note;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(fields: Fields) {
    setSaving(true);
    setMessage("");
    const currentDraft = draft;
    try {
      const response = await fetch(url + "/" + row.id, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Review-Request": "1",
        },
        body: JSON.stringify({ revision: state.revision, ...fields }),
      });
      if (response.status === 409) {
        const latest = (await response.json()) as StudyState;
        onDraftChange(row.id, currentDraft);
        onStateChange(latest);
        onConflictChange(row.id, true);
        return;
      }
      if (!response.ok) throw new Error();
      const latest = (await response.json()) as StudyState;
      onStateChange(latest);
      if (fields.note !== undefined) {
        onClearDraft(row.id);
        onConflictChange(row.id, false);
      }
      setMessage("已保存");
    } catch {
      setMessage("保存失败，输入已保留，请重试。");
    } finally {
      setSaving(false);
    }
  }

  function handleApplySaved() {
    onClearDraft(row.id);
    onConflictChange(row.id, false);
    setMessage("已填入已保存内容");
  }

  return (
    <article className="study-item">
      {children}

      <div className="study-controls-bar">
        <label className="study-check-label">
          <input
            type="checkbox"
            checked={state.completed}
            disabled={saving}
            onChange={(e) => void save({ completed: e.target.checked })}
          />
          <span>已完成 · {row.topic.name}</span>
        </label>
        <span className="study-chapter-tag">{row.topic.chapter}</span>
      </div>

      <div className="study-note">
        <label htmlFor={"note-" + row.id}>学习笔记 · {row.topic.name}</label>
        <textarea
          id={"note-" + row.id}
          rows={3}
          value={draft}
          onChange={(e) => onDraftChange(row.id, e.target.value)}
        />
      </div>

      {conflict && (
        <div
          className="conflict-box"
          role="region"
          aria-label={`笔记冲突核对 · ${row.topic.name}`}
        >
          <div className="conflict-head">
            <p className="conflict-title" role="status">
              其他页面已更新此项，请核对已保存的笔记后再保存。
            </p>
            <button
              type="button"
              className="sub conflict-apply-btn"
              disabled={saving}
              onClick={handleApplySaved}
            >
              填入已保存内容
            </button>
          </div>
          <div className="conflict-columns">
            <div className="conflict-col">
              <div className="conflict-col-label">已保存内容</div>
              <pre className="conflict-text">{state.note || "（空）"}</pre>
            </div>
            <div className="conflict-col">
              <div className="conflict-col-label">当前草稿</div>
              <pre className="conflict-text">{draft || "（空）"}</pre>
            </div>
          </div>
        </div>
      )}

      <div className="study-actions">
        <button
          type="button"
          disabled={saving || (draft === state.note && !conflict)}
          onClick={() => void save({ note: draft })}
        >
          保存笔记
        </button>
        {message && (
          <span
            className={
              message.startsWith("保存失败")
                ? "study-status is-error"
                : "study-status"
            }
            role="status"
          >
            {message}
          </span>
        )}
      </div>
    </article>
  );
}

export type StudyProps = {
  rows: Topic[];
  version: string;
  states: Map<string, StudyState> | null;
  failed: boolean;
  onRetry: () => void;
  onStateChange: (next: StudyState) => void;
  drafts: Record<string, string>;
  onDraftChange: (topicId: string, value: string) => void;
  onClearDraft: (topicId: string) => void;
  conflicts: Record<string, boolean>;
  onConflictChange: (topicId: string, value: boolean) => void;
  detail: (row: Topic) => ReactNode;
};

export function Study({
  rows,
  version,
  states,
  failed,
  onRetry,
  onStateChange,
  drafts,
  onDraftChange,
  onClearDraft,
  conflicts,
  onConflictChange,
  detail,
}: StudyProps) {
  const url = "/api/course/versions/" + version + "/states";

  if (failed) {
    return (
      <p className="alert-inline" role="alert">
        读取学习记录失败。{" "}
        <button type="button" className="sub" onClick={onRetry}>
          重试
        </button>
      </p>
    );
  }

  if (!states) {
    return <p className="hint">正在读取学习记录…</p>;
  }

  return (
    <div className="study-list">
      {rows.map((row) => (
        <StudyItem
          key={row.id}
          row={row}
          initial={states.get(row.id)}
          draftOverride={drafts[row.id]}
          conflict={Boolean(conflicts[row.id])}
          url={url}
          onStateChange={onStateChange}
          onDraftChange={onDraftChange}
          onClearDraft={onClearDraft}
          onConflictChange={onConflictChange}
        >
          {detail(row)}
        </StudyItem>
      ))}
    </div>
  );
}
