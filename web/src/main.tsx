import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Analysis } from "./Analysis";
import { ImportWorkspace } from "./ImportWorkspace";
import { Videos } from "./Videos";
import {
  courseApi,
  defaultCourse, CurrentCourse, useCourseBase, listCourses, createCourse,
  errorMessage,
  fetchPublishedAnalysis,
  runBatchAnalysis,
} from "./api";
import {
  formatBatchLabel,
  type CourseSummary,
  type BatchItem,
  type DraftFile,
  type Role,
  type SavedFile,
  type Snapshot,
} from "./types";

function Workspace({ course }: { course: CourseSummary }) {
  const base = useCourseBase();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const batchKey = "selected-job:" + course.id;
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
    if (id && mounted.current) {
      sessionStorage.setItem(batchKey, id);
    }
  }

  useEffect(() => {
    let live = true;
    const token = ++analysisGeneration.current;
    setInitialLoading(true);

    const loadImport = Promise.all([
      courseApi<SavedFile[]>(base, "files"),
      courseApi<string[]>(base, "jobs"),
    ])
      .then(([fileList, jobList]) => {
        if (!live) return;
        setSaved(fileList);
        setJobs(jobList);
        const remembered = sessionStorage.getItem(batchKey) ?? (course.id === "default" ? sessionStorage.getItem("selected-job") : "") ?? "";
        const nextJob = jobList.includes(remembered)
          ? remembered
          : jobList[0] || "";
        selectJob(nextJob);
        setImportError("");
      })
      .catch((e) => {
        if (live) setImportError(errorMessage(e));
      });

    const loadPublished = fetchPublishedAnalysis(base)
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
        const list = await courseApi<BatchItem[]>(base, `jobs/${selectedJob}`);
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
        if (!mounted.current) return;
        const body = new FormData();
        body.append("file", d.file);
        body.append("role", d.role);
        try {
          const { id } = await courseApi<{ id: string }>(base, "files", {
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
      if (!mounted.current) return;
      setDraft(failedDrafts);
      setPicked([...ids]);
      setSaved((old) =>
        Array.from(new Map([...old, ...added].map((f) => [f.id, f])).values()),
      );
      if (ids.size > 0) {
        const { id } = await courseApi<{ id: string }>(base, "jobs", {
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
      await courseApi(base, `jobs/${selectedJob}/${fileId}/${action}`, {
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
      const snap = await runBatchAnalysis(base, selectedJob);
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
      const snap = await fetchPublishedAnalysis(base);
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
    <>


      <h1 className={publishedSnapshot ? "course-title is-compact" : "course-title"}>
        {course.name}
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
    </>
  );
}

function App() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [id, setId] = useState(() => sessionStorage.getItem("selected-course") ?? "default");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const course = courses.find(c => c.id === id) ?? defaultCourse;

  useEffect(() => { void listCourses().then(setCourses); }, []);
  useEffect(() => {
    if (courses.length) {
      document.title = course.name + " · 个人期末复习助手";
      sessionStorage.setItem("selected-course", course.id);
    }
  }, [course, courses]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) { setError("请输入课程名称"); return; }
    setBusy(true);
    try {
      const row = await createCourse(name);
      setCourses(old => [...old, row]);
      setId(row.id);
      setCreating(false);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <main>
      <header className="masthead">
        <div className="masthead-brand">
          <span className="brand-title">期末复习助手</span>
          <span className="brand-sep" aria-hidden="true">
            ·
          </span>
          <span className="brand-sub">本机多课程工作台</span>
        </div>
        <div className="course-actions">
          <select aria-label="当前课程" value={course.id} disabled={!courses.length || busy}
            onChange={e => { setId(e.target.value); setCreating(false); }}>
            {(courses.length ? courses : [defaultCourse]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className="sub" disabled={!courses.length || busy}
            onClick={() => { setCreating(true); setError(""); setName(""); }}>新建课程</button>
        </div>
      </header>
    {creating && <form className="course-form" onSubmit={submit}
      onKeyDown={e => { if (e.key === "Escape" && !busy) setCreating(false); }}>
      <label>新课程名称 <input autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
      <button disabled={busy}>创建课程</button>
      <button type="button" className="sub" disabled={busy} onClick={() => setCreating(false)}>取消</button>
      {error && <p role="alert">{error}</p>}
    </form>}
    {courses.length > 0 && <CurrentCourse.Provider value={course}>
      <Workspace key={course.id} course={course} />
    </CurrentCourse.Provider>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
