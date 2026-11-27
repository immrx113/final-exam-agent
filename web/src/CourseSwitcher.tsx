import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorMessage } from "./api";
import type { CourseSummary } from "./types";

type PopoverMode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "rename"; courseId: string; initialName: string }
  | { kind: "delete"; courseId: string; courseName: string };

export type CourseSwitcherProps = {
  courses: CourseSummary[];
  currentCourse: CourseSummary;
  disabled?: boolean;
  onSelectCourse: (id: string) => void;
  onCreateCourse: (name: string) => Promise<void>;
  onRenameCourse: (id: string, name: string) => Promise<void>;
  onDeleteCourse: (id: string) => Promise<void>;
};

export function CourseSwitcher({
  courses,
  currentCourse,
  disabled = false,
  onSelectCourse,
  onCreateCourse,
  onRenameCourse,
  onDeleteCourse,
}: CourseSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PopoverMode>({ kind: "list" });
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);

  function closePopover(restoreFocus = false) {
    setOpen(false);
    setMode({ kind: "list" });
    setInputValue("");
    setError("");
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function cancelSubMode() {
    if (busy) return;
    setMode({ kind: "list" });
    setInputValue("");
    setError("");
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (busy) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closePopover(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (busy) return;
      closePopover(true);
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, busy]);

  useEffect(() => {
    if (!open) return;
    if (mode.kind === "create" || mode.kind === "rename") {
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.closest(".course-menu-item")?.scrollIntoView({ block: "nearest" });
          el.focus({ preventScroll: true });
          el.select();
        }
      });
    } else if (mode.kind === "delete") {
      requestAnimationFrame(() => {
        const el = cancelDeleteRef.current;
        if (el) {
          el.closest(".course-menu-item")?.scrollIntoView({ block: "nearest" });
          el.focus({ preventScroll: true });
        }
      });
    }
  }, [open, mode]);

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!inputValue.trim()) {
      setError("请输入课程名称");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreateCourse(inputValue);
      closePopover(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || mode.kind !== "rename") return;
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setError("请输入课程名称");
      return;
    }
    if (trimmed === mode.initialName) {
      cancelSubMode();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onRenameCourse(mode.courseId, inputValue);
      setMode({ kind: "list" });
      setInputValue("");
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (busy || mode.kind !== "delete") return;
    const deletingCurrent = mode.courseId === currentCourse.id;
    setBusy(true);
    setError("");
    try {
      await onDeleteCourse(mode.courseId);
      if (deletingCurrent) {
        closePopover(true);
      } else {
        setMode({ kind: "list" });
        setError("");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="course-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "course-trigger is-open" : "course-trigger"}
        aria-label="当前课程"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={() => {
          if (open) {
            closePopover(false);
          } else {
            setMode({ kind: "list" });
            setInputValue("");
            setError("");
            setOpen(true);
          }
        }}
      >
        <span className="course-trigger-label">{currentCourse.name}</span>
        <svg
          className="course-trigger-chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="course-popover"
          role="dialog"
          aria-label="切换与管理课程"
        >
          <ul className="course-menu-list" role="list">
            {courses.map((item) => {
              const isSelected = item.id === currentCourse.id;
              const isDefault = item.id === "default";

              if (mode.kind === "rename" && mode.courseId === item.id) {
                return (
                  <li key={item.id} className="course-menu-item is-editing">
                    <form
                      className="course-inline-form"
                      onSubmit={(e) => void handleRenameSubmit(e)}
                    >
                      <input
                        ref={inputRef}
                        aria-label="课程新名称"
                        value={inputValue}
                        maxLength={80}
                        disabled={busy}
                        onChange={(e) => setInputValue(e.target.value)}
                      />
                      {error && (
                        <p className="course-popover-error" role="alert">
                          {error}
                        </p>
                      )}
                      <div className="course-inline-actions is-end">
                        <button
                          type="button"
                          className="sub"
                          disabled={busy}
                          onClick={cancelSubMode}
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          className="primary primary-compact"
                          disabled={busy}
                        >
                          {busy ? "保存中…" : "保存"}
                        </button>
                      </div>
                    </form>
                  </li>
                );
              }

              if (mode.kind === "delete" && mode.courseId === item.id) {
                return (
                  <li key={item.id} className="course-menu-item is-deleting">
                    <div
                      className="course-delete-confirm"
                      role="group"
                      aria-label={`确认删除 · ${item.name}`}
                    >
                      <p className="course-delete-title">
                        确认删除「{item.name}」？
                      </p>
                      <p className="course-delete-desc">
                        将永久移除该课的文件记录、处理批次、分析结果与学习笔记。
                      </p>
                      {error && (
                        <p className="course-popover-error" role="alert">
                          {error}
                        </p>
                      )}
                      <div className="course-inline-actions is-end">
                        <button
                          ref={cancelDeleteRef}
                          type="button"
                          className="sub"
                          disabled={busy}
                          onClick={cancelSubMode}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="course-danger-btn"
                          disabled={busy}
                          onClick={() => void handleConfirmDelete()}
                        >
                          {busy ? "正在删除…" : "确认删除"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={item.id}
                  className={
                    isSelected
                      ? "course-menu-item is-selected"
                      : "course-menu-item"
                  }
                >
                  <button
                    type="button"
                    className="course-option"
                    title={item.name}
                    aria-current={isSelected ? "true" : undefined}
                    disabled={busy}
                    onClick={() => {
                      onSelectCourse(item.id);
                      closePopover(false);
                    }}
                  >
                    <span className="course-check" aria-hidden="true">
                      {isSelected && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                        >
                          <path
                            d="M2.5 7.2L5.6 10.3L11.5 4"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="course-option-name">{item.name}</span>
                  </button>

                  {!isDefault && (
                    <div className="course-row-actions">
                      <button
                        type="button"
                        className="course-icon-btn"
                        aria-label={`重命名课程 · ${item.name}`}
                        title="重命名"
                        disabled={busy}
                        onClick={() => {
                          setMode({
                            kind: "rename",
                            courseId: item.id,
                            initialName: item.name,
                          });
                          setInputValue(item.name);
                          setError("");
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M11.6 2.4a1.4 1.4 0 0 1 2 2L5.3 12.7 2 13.5l.8-3.3 8.8-7.8Z"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="course-icon-btn is-danger"
                        aria-label={`删除课程 · ${item.name}`}
                        title="删除"
                        disabled={busy}
                        onClick={() => {
                          setMode({
                            kind: "delete",
                            courseId: item.id,
                            courseName: item.name,
                          });
                          setError("");
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4.2 4.2l.6 9a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-9"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="course-popover-footer">
            {mode.kind === "create" ? (
              <form
                className="course-create-form"
                onSubmit={(e) => void handleCreateSubmit(e)}
              >
                <label
                  className="course-create-label"
                  htmlFor="new-course-name-input"
                >
                  新课程名称
                </label>
                <input
                  id="new-course-name-input"
                  ref={inputRef}
                  value={inputValue}
                  maxLength={80}
                  placeholder="输入课程名称，例如：操作系统"
                  disabled={busy}
                  onChange={(e) => setInputValue(e.target.value)}
                />
                {error && (
                  <p className="course-popover-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="course-inline-actions is-end">
                  <button
                    type="button"
                    className="sub"
                    disabled={busy}
                    onClick={cancelSubMode}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="primary primary-compact"
                    disabled={busy}
                  >
                    {busy ? "创建中…" : "创建课程"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="course-create-trigger"
                disabled={busy}
                onClick={() => {
                  setMode({ kind: "create" });
                  setInputValue("");
                  setError("");
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M7 2v10M2 7h10"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                新建课程
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
