import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Analysis } from "./Analysis";
import { ImportWorkspace } from "./ImportWorkspace";
import { Videos } from "./Videos";
import {
  courseApi,
  errorMessage,
  fetchPublishedAnalysis,
  runBatchAnalysis,
} from "./api";
import {
  formatBatchLabel,
  type BatchItem,
  type DraftFile,
  type Role,
  type SavedFile,
  type Snapshot,
} from "./types";

function App() {
  const [draft, setDraft] = useState<DraftFile[]>([]);
  const [saved, setSaved] = useState<SavedFile[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [jobs, setJobs] = useState<string[]>([]);
  const [selectedJob, setSelectedJob] = useState("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [importError, setImportError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pollTick, setPollTick] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);

  const [publishedSnapshot, setPublishedSnapshot] = useState<Snapshot | null>(
    null,
  );
  const [initialLoading, setInitialLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const analysisGeneration = useRef(0);

  function selectJob(id: string) {
    setSelectedJob((prev) => {
      if (id !== prev) setItems([]);
      return id;
    });
    if (id) {
      sessionStorage.setItem("selected-job", id);
    }
  }

  useEffect(() => {
    let live = true;
    const token = ++analysisGeneration.current;
    setInitialLoading(true);

    const loadImport = Promise.all([
      courseApi<SavedFile[]>("files"),
      courseApi<string[]>("jobs"),
    ])
      .then(([fileList, jobList]) => {
        if (!live) return;
        setSaved(fileList);
        setJobs(jobList);
        const remembered = sessionStorage.getItem("selected-job") || "";
        const nextJob = jobList.includes(remembered)
          ? remembered
          : jobList[0] || "";
        selectJob(nextJob);
        setImportError("");
      })
      .catch((e) => {
        if (live) setImportError(errorMessage(e));
      });

    const loadPublished = fetchPublishedAnalysis()
      .then((snap) => {
        if (live && token === analysisGeneration.current) {
          setPublishedSnapshot(snap);
          setAnalysisError("");
        }
      })
      .catch((e) => {
        if (live && token === analysisGeneration.current) {
          setAnalysisError(errorMessage(e, "读取失败"));
        }
      })
      .finally(() => {
        if (live && token === analysisGeneration.current) {
          setInitialLoading(false);
        }
      });

    void Promise.allSettled([loadImport, loadPublished]);

    return () => {
      live = false;
    };
  }, [reloadTick]);

  useEffect(() => {
    if (!selectedJob) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const list = await courseApi<BatchItem[]>(`jobs/${selectedJob}`);
        if (!active) return;
        setItems(list);
        setPollError("");
        if (list.every((i) => i.status === "ready" || i.status === "failed")) {
          return;
        }
      } catch (e) {
        if (active) setPollError(errorMessage(e));
      }
      if (active) timer = setTimeout(poll, 1000);
    }

    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedJob, pollTick]);

  async function handleSubmit() {
    setSubmitting(true);
    setImportError("");
    const ids = new Set(picked);
    const added: SavedFile[] = [];
    const failedDrafts: DraftFile[] = [];
    const errors: string[] = [];

    try {
      for (const d of draft) {
        const body = new FormData();
        body.append("file", d.file);
        body.append("role", d.role);
        try {
          const { id } = await courseApi<{ id: string }>("files", {
            method: "POST",
            body,
          });
          ids.add(id);
          added.push({ id, name: d.file.name, role: d.role });
        } catch (e) {
          failedDrafts.push(d);
          errors.push(`${d.file.name}：${errorMessage(e)}`);
        }
      }
      setDraft(failedDrafts);
      setPicked([...ids]);
      setSaved((old) =>
        Array.from(new Map([...old, ...added].map((f) => [f.id, f])).values()),
      );
      if (ids.size > 0) {
        const { id } = await courseApi<{ id: string }>("jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: [...ids] }),
        });
        setJobs((prev) => (prev.includes(id) ? prev : [id, ...prev]));
        selectJob(id);
        setPollTick((n) => n + 1);
        setPicked([]);
      }
    } catch (e) {
      errors.push(errorMessage(e));
    } finally {
      setImportError(errors.join("\n"));
      setSubmitting(false);
    }
  }

  async function handleRetryFile(
    fileId: string,
    action: "retry" | "recheck" = "retry",
  ) {
    if (!selectedJob) return;
    try {
      await courseApi(`jobs/${selectedJob}/${fileId}/${action}`, {
        method: "POST",
      });
      setPollTick((v) => v + 1);
      setImportError("");
    } catch (e) {
      setImportError(errorMessage(e));
    }
  }

  async function handleAnalyzeBatch() {
    if (!selectedJob) return;
    const token = ++analysisGeneration.current;
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const snap = await runBatchAnalysis(selectedJob);
      if (token === analysisGeneration.current) {
        setPublishedSnapshot(snap);
      }
    } catch (e) {
      if (token === analysisGeneration.current) {
        setAnalysisError(errorMessage(e, "读取失败"));
      }
    } finally {
      if (token === analysisGeneration.current) {
        setAnalyzing(false);
      }
    }
  }

  async function handleLoadLatestAnalysis() {
    const token = ++analysisGeneration.current;
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const snap = await fetchPublishedAnalysis();
      if (token === analysisGeneration.current) {
        setPublishedSnapshot(snap);
      }
    } catch (e) {
      if (token === analysisGeneration.current) {
        setAnalysisError(errorMessage(e, "读取失败"));
      }
    } finally {
      if (token === analysisGeneration.current) {
        setAnalyzing(false);
      }
    }
  }

  const canAnalyze =
    Boolean(selectedJob) &&
    !submitting &&
    items.some((i) => i.status === "ready") &&
    items.every((i) => i.status === "ready" || i.status === "failed");

  const publishedBatchLabel = publishedSnapshot
    ? formatBatchLabel(jobs, publishedSnapshot.job)
    : "";

  return (
    <main>
      <header className="masthead">
        <div className="masthead-brand">
          <span className="brand-title">期末复习助手</span>
          <span className="brand-sep" aria-hidden="true">
            ·
          </span>
          <span className="brand-sub">本机单课程工作台</span>
        </div>
        <span className="course-pill">数据库原理</span>
      </header>

      <h1 className={publishedSnapshot ? "course-title is-compact" : "course-title"}>
        数据库原理
      </h1>

      <ImportWorkspace
        draft={draft}
        saved={saved}
        picked={picked}
        jobs={jobs}
        selectedJob={selectedJob}
        items={items}
        publishedJob={publishedSnapshot?.job ?? null}
        hasPublished={Boolean(publishedSnapshot)}
        submitting={submitting}
        importError={importError}
        pollError={pollError}
        analyzing={analyzing}
        analysisError={analysisError}
        canAnalyze={canAnalyze}
        onAddDrafts={(role: Role, files: File[]) =>
          setDraft((prev) => [
            ...prev,
            ...files.map((file) => ({
              key: crypto.randomUUID(),
              file,
              role,
            })),
          ])
        }
        onChangeDraftRole={(key: string, role: Role) =>
          setDraft((prev) =>
            prev.map((d) => (d.key === key ? { ...d, role } : d)),
          )
        }
        onRemoveDraft={(key: string) =>
          setDraft((prev) => prev.filter((d) => d.key !== key))
        }
        onTogglePicked={(fileId: string, checked: boolean) =>
          setPicked((prev) =>
            checked ? [...prev, fileId] : prev.filter((id) => id !== fileId),
          )
        }
        onSubmit={() => void handleSubmit()}
        onReloadCourse={() => setReloadTick((v) => v + 1)}
        onSelectJob={selectJob}
        onRetryFile={(fileId, action) => void handleRetryFile(fileId, action)}
        onAnalyze={() => void handleAnalyzeBatch()}
        onLoadLatestAnalysis={() => void handleLoadLatestAnalysis()}
      />

      <Analysis
        snapshot={publishedSnapshot}
        hasJobs={jobs.length > 0}
        initialLoading={initialLoading}
        selectedJob={selectedJob}
        publishedBatchLabel={publishedBatchLabel}
        onSelectPublishedJob={() => {
          if (publishedSnapshot?.job) {
            selectJob(publishedSnapshot.job);
          }
        }}
      />

      {publishedSnapshot && (
        <Videos
          key={publishedSnapshot.version}
          version={publishedSnapshot.version}
          batchLabel={publishedBatchLabel}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
