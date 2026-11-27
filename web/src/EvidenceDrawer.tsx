import { useCourseBase } from "./api";
import { useEffect, useRef, useState } from "react";
import { ExternalIcon } from "./TopicCard";
import type { ActiveEvidence } from "./types";

type ParsedLine = {
  line: number;
  text: string;
};

type ZoomLevel = "fit" | "125" | "160";

const ZOOM_OPTIONS: Array<{ value: ZoomLevel; label: string }> = [
  { value: "fit", label: "适应宽度" },
  { value: "125", label: "125%" },
  { value: "160", label: "160%" },
];

function parseLineDocument(raw: string): ParsedLine[] {
  if (/<li\b/i.test(raw) || /<!doctype\s+html/i.test(raw) || /<ol\b/i.test(raw)) {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const items = Array.from(doc.querySelectorAll("ol > li, li[id^='L']"));
    if (items.length > 0) {
      return items.map((li, idx) => {
        const idMatch = /^L(\d+)$/i.exec(li.id || "");
        const line = idMatch ? Number(idMatch[1]) : idx + 1;
        const pre = li.querySelector("pre");
        return {
          line,
          text: pre ? pre.textContent ?? "" : li.textContent ?? "",
        };
      });
    }
  }
  return raw.split(/\r?\n/).map((text, idx) => ({
    line: idx + 1,
    text,
  }));
}

export type EvidenceDrawerProps = {
  evidence: ActiveEvidence;
  onClose: () => void;
};

export function EvidenceDrawer({ evidence, onClose }: EvidenceDrawerProps) {
  const base = useCourseBase();
  const hashMatch = /#L(\d+)$/i.exec(evidence.url);
  const targetLine = hashMatch ? Number(hashMatch[1]) : null;
  const cleanUrl = evidence.url.split("#")[0];
  const isLineMode =
    targetLine !== null || /\.(?:md|html|txt)$/i.test(cleanUrl);

  const [lines, setLines] = useState<ParsedLine[] | null>(null);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineError, setLineError] = useState("");
  const [imgStatus, setImgStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [zoom, setZoom] = useState<ZoomLevel>("fit");
  const [retryTick, setRetryTick] = useState(0);

  const targetLineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setZoom("fit");
  }, [evidence.key]);

  useEffect(() => {
    if (!isLineMode) {
      setLines(null);
      setLineError("");
      setLineLoading(false);
      setImgStatus("loading");
      return;
    }

    const controller = new AbortController();
    setLineLoading(true);
    setLineError("");
    setLines(null);

    fetch(cleanUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const raw = await response.text();
        if (!controller.signal.aborted) {
          setLines(parseLineDocument(raw));
          setLineLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLineError("读取原文内容失败，请重试或点击上方“新窗口打开”。");
        setLineLoading(false);
      });

    return () => controller.abort();
  }, [cleanUrl, isLineMode, retryTick]);

  useEffect(() => {
    if (lines && targetLine !== null && targetLineRef.current) {
      targetLineRef.current.scrollIntoView({ block: "center" });
    }
  }, [lines, targetLine]);

  return (
    <>
      <div
        className="drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside className="evidence-drawer" aria-label="页内原文对照">
        <div className="drawer-head">
          <div className="drawer-meta">
            <p className="drawer-kicker">
              正在核对：<strong>{evidence.topicName}</strong> ·{" "}
              {evidence.contextLabel}
            </p>
            <p className="drawer-source">
              <span>来源：</span>
              <span className="file-name">{evidence.fileName}</span>
              <span> · {evidence.locLabel}</span>
              {evidence.review && (
                <span className="review-flag">待核对</span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="sub drawer-close"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="drawer-toolbar">
          <div className="drawer-links">
            {evidence.fileId && (
              <a
                className="drawer-link"
                href={`${base}/files/${evidence.fileId}/original`}
                download
              >
                下载原件
              </a>
            )}
            <a
              className="drawer-link"
              href={evidence.url}
              target="_blank"
              rel="noreferrer"
            >
              新窗口打开
              <ExternalIcon />
            </a>
          </div>

          {!isLineMode && (
            <div className="zoom-controls" role="group" aria-label="原页缩放">
              {ZOOM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={
                    zoom === opt.value ? "sub zoom-btn is-active" : "sub zoom-btn"
                  }
                  aria-pressed={zoom === opt.value}
                  onClick={() => setZoom(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="drawer-stage">
          {isLineMode ? (
            lineLoading ? (
              <p className="hint drawer-state">正在读取原文行内容…</p>
            ) : lineError ? (
              <div className="drawer-error" role="alert">
                <p>{lineError}</p>
                <button
                  type="button"
                  className="sub"
                  onClick={() => setRetryTick((n) => n + 1)}
                >
                  重试加载
                </button>
              </div>
            ) : lines && lines.length > 0 ? (
              <div
                className="line-viewer"
                role="region"
                aria-label="原文行号对照"
              >
                {lines.map((item) => {
                  const isTarget = targetLine === item.line;
                  return (
                    <div
                      key={item.line}
                      ref={isTarget ? targetLineRef : undefined}
                      id={`drawer-L${item.line}`}
                      data-line={item.line}
                      data-target-line={isTarget ? "true" : undefined}
                      aria-current={isTarget ? "location" : undefined}
                      className={
                        isTarget ? "code-line is-target" : "code-line"
                      }
                    >
                      <span className="line-num">
                        {String(item.line).padStart(2, "0")}
                      </span>
                      <span className="line-text">{item.text || " "}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="hint drawer-state">该文件暂无可显示的文本行。</p>
            )
          ) : (
            <div className="image-stage">
              {imgStatus === "loading" && (
                <p className="hint drawer-state">正在加载原页预览图像…</p>
              )}
              {imgStatus === "error" ? (
                <div className="drawer-error" role="alert">
                  <p>原页图像加载失败，请重试或点击上方“新窗口打开”。</p>
                  <button
                    type="button"
                    className="sub"
                    onClick={() => {
                      setImgStatus("loading");
                      setRetryTick((n) => n + 1);
                    }}
                  >
                    重试加载
                  </button>
                </div>
              ) : (
                <img
                  key={`${evidence.url}-${retryTick}`}
                  src={evidence.url}
                  alt={`${evidence.fileName} · ${evidence.locLabel}`}
                  className={`preview-image zoom-${zoom}${imgStatus === "loading" ? " is-loading" : ""}`}
                  onLoad={() => setImgStatus("ready")}
                  onError={() => setImgStatus("error")}
                />
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
