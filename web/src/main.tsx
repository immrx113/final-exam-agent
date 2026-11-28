import { useEffect, useRef, useState, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Analysis } from "./Analysis";
import { CourseSwitcher } from "./CourseSwitcher";
import { ImportWorkspace } from "./ImportWorkspace";
import { useAnalysisTask } from "./useAnalysisTask";
import { Videos } from "./Videos";
import {
  courseApi,
  defaultCourse,
  CurrentCourse,
  useCourseBase,
  listCourses,
  createCourse,
  renameCourse,
  deleteCourse,
  errorMessage,
  fetchPublishedAnalysis,

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

const EMPTY_DRAFT_FILES: DraftFile[] = [];
const EMPTY_PICKED: string[] = [];
const EMPTY_STUDY_DRAFTS: Record<string, string> = {};

type WorkspaceProps = {
  course: CourseSummary;
  draft: DraftFile[];
  picked: string[];
  studyDraftsByScope: Record<string, Record<string, string>>;
  onUpdateDraft: (updater: SetStateAction<DraftFile[]>) => void;
  onUpdatePicked: (updater: SetStateAction<string[]>) => void;
  onStudyDraftChange: (version: string, topicId: string, value: string) => void;
  onClearStudyDraft: (version: string, topicId: string) => void;
  onCoursePublishedChange: (hasPublished: boolean) => void;
};

function Workspace({
  course,
  draft,
  picked,
  studyDraftsByScope,
  onUpdateDraft,
  onUpdatePicked,
  onStudyDraftChange,
  onClearStudyDraft,
  onCoursePublishedChange,
}: WorkspaceProps) {
  const base = useCourseBase();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const batchKey = "selected-job:" + course.id;
  const [saved, setSaved] = useState<SavedFile[]>([]);
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
        const validIds = new Set(fileList.map((f) => f.id));
        onUpdatePicked((prev) =>
          prev.every((fid) => validIds.has(fid))
            ? prev
            : prev.filter((fid) => validIds.has(fid)),
        );
        setJobs(jobList);
        const remembered =
          sessionStorage.getItem(batchKey) ??
          (course.id === "default"
            ? sessionStorage.getItem("selected-job")
            : "") ??
          "";
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
          onCoursePublishedChange(Boolean(snap));
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
      onUpdateDraft(failedDrafts);
      onUpdatePicked([...ids]);
      setSaved((old) =>
        Array.from(new Map([...old, ...added].map((f) => [f.id, f])).values()),
      );
      if (ids.size > 0) {
        const { id } = await courseApi<{ id: string }>(base, "jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: [...ids] }),
        });
        if (!mounted.current) return;
        setJobs((prev) => (prev.includes(id) ? prev : [id, ...prev]));
        selectJob(id);
        setPollTick((n) => n + 1);
        onUpdatePicked([]);
      }
    } catch (e) {
      errors.push(errorMessage(e));
    } finally {
      if (mounted.current) {
        setImportError(errors.join("\n"));
        setSubmitting(false);
      }
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

  const analysisTask = useAnalysisTask(base, selectedJob, (snap) => {
    ++analysisGeneration.current;
    setPublishedSnapshot(snap);
    setInitialLoading(false);
    setAnalyzing(false);
    setAnalysisError("");
    onCoursePublishedChange(true);
  });

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

  const activeStudyDrafts = publishedSnapshot
    ? (studyDraftsByScope[course.id + ":" + publishedSnapshot.version] ??
      EMPTY_STUDY_DRAFTS)
    : EMPTY_STUDY_DRAFTS;

  return (
    <>
      <h1
        className={
          publishedSnapshot ? "course-title is-compact" : "course-title"
        }
      >
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
        hasPublished={
          Boolean(publishedSnapshot) || (initialLoading && course.hasPublished)
        }
        submitting={submitting}
        importError={importError}
        pollError={pollError}
        analyzing={analyzing || analysisTask.busy}
        analyzeLabel={analysisTask.unconfirmed ? "重试提交" : analysisTask.task?.job === selectedJob ? "重新分析本批资料" : "分析本批资料"}
        taskStatus={analysisTask.task && `${formatBatchLabel(jobs, analysisTask.task.job)} · ${analysisTask.label} · 任务 ${analysisTask.task.id}${analysisTask.task.reason ? " · " + analysisTask.task.reason : ""}`}
        analysisError={analysisTask.error || analysisError}
        canAnalyze={canAnalyze}
        onAddDrafts={(role: Role, files: File[]) =>
          onUpdateDraft((prev) => [
            ...prev,
            ...files.map((file) => ({
              key: crypto.randomUUID(),
              file,
              role,
            })),
          ])
        }
        onChangeDraftRole={(key: string, role: Role) =>
          onUpdateDraft((prev) =>
            prev.map((d) => (d.key === key ? { ...d, role } : d)),
          )
        }
        onRemoveDraft={(key: string) =>
          onUpdateDraft((prev) => prev.filter((d) => d.key !== key))
        }
        onTogglePicked={(fileId: string, checked: boolean) =>
          onUpdatePicked((prev) =>
            checked ? [...prev, fileId] : prev.filter((id) => id !== fileId),
          )
        }
        onSubmit={() => void handleSubmit()}
        onReloadCourse={() => setReloadTick((v) => v + 1)}
        onSelectJob={selectJob}
        onRetryFile={(fileId, action) => void handleRetryFile(fileId, action)}
        onAnalyze={() => void analysisTask.submit()}
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
        studyDrafts={activeStudyDrafts}
        onStudyDraftChange={onStudyDraftChange}
        onClearStudyDraft={onClearStudyDraft}
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
  const [id, setId] = useState(
    () => sessionStorage.getItem("selected-course") ?? "default",
  );
  const [importDraftsByCourse, setImportDraftsByCourse] = useState<
    Record<string, DraftFile[]>
  >({});
  const [pickedByCourse, setPickedByCourse] = useState<
    Record<string, string[]>
  >({});
  const [studyDraftsByScope, setStudyDraftsByScope] = useState<
    Record<string, Record<string, string>>
  >({});

  const course = courses.find((c) => c.id === id) ?? defaultCourse;

  useEffect(() => {
    void listCourses().then(setCourses);
  }, []);

  useEffect(() => {
    if (courses.length) {
      document.title = course.name + " · 个人期末复习助手";
      sessionStorage.setItem("selected-course", course.id);
    }
  }, [course, courses]);

  function updateCourseDraft(
    courseId: string,
    updater: SetStateAction<DraftFile[]>,
  ) {
    setImportDraftsByCourse((prev) => {
      const current = prev[courseId] ?? EMPTY_DRAFT_FILES;
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next === current) return prev;
      if (next.length === 0) {
        if (!(courseId in prev)) return prev;
        const copy = { ...prev };
        delete copy[courseId];
        return copy;
      }
      return { ...prev, [courseId]: next };
    });
  }

  function updateCoursePicked(
    courseId: string,
    updater: SetStateAction<string[]>,
  ) {
    setPickedByCourse((prev) => {
      const current = prev[courseId] ?? EMPTY_PICKED;
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next === current) return prev;
      if (next.length === 0) {
        if (!(courseId in prev)) return prev;
        const copy = { ...prev };
        delete copy[courseId];
        return copy;
      }
      return { ...prev, [courseId]: next };
    });
  }

  function handleStudyDraftChange(
    courseId: string,
    version: string,
    topicId: string,
    value: string,
  ) {
    const scope = courseId + ":" + version;
    setStudyDraftsByScope((prev) => ({
      ...prev,
      [scope]: {
        ...(prev[scope] ?? EMPTY_STUDY_DRAFTS),
        [topicId]: value,
      },
    }));
  }

  function handleClearStudyDraft(
    courseId: string,
    version: string,
    topicId: string,
  ) {
    const scope = courseId + ":" + version;
    setStudyDraftsByScope((prev) => {
      const existing = prev[scope];
      if (!existing || !(topicId in existing)) return prev;
      const nextScope = { ...existing };
      delete nextScope[topicId];
      const next = { ...prev };
      if (Object.keys(nextScope).length === 0) {
        delete next[scope];
      } else {
        next[scope] = nextScope;
      }
      return next;
    });
  }

  async function handleCreateCourse(name: string) {
    const row = await createCourse(name);
    setCourses((old) => [...old, row]);
    setId(row.id);
  }

  async function handleRenameCourse(courseId: string, name: string) {
    const updated = await renameCourse(courseId, name);
    setCourses((old) => old.map((c) => (c.id === courseId ? updated : c)));
  }

  async function handleDeleteCourse(courseId: string) {
    await deleteCourse(courseId);
    setCourses((old) => old.filter((c) => c.id !== courseId));
    setImportDraftsByCourse((prev) => {
      if (!(courseId in prev)) return prev;
      const copy = { ...prev };
      delete copy[courseId];
      return copy;
    });
    setPickedByCourse((prev) => {
      if (!(courseId in prev)) return prev;
      const copy = { ...prev };
      delete copy[courseId];
      return copy;
    });
    setStudyDraftsByScope((prev) => {
      const prefix = courseId + ":";
      const keys = Object.keys(prev).filter((k) => k.startsWith(prefix));
      if (keys.length === 0) return prev;
      const copy = { ...prev };
      for (const k of keys) delete copy[k];
      return copy;
    });
    sessionStorage.removeItem("selected-job:" + courseId);
    if (id === courseId) {
      setId("default");
    }
  }

  return (
    <main>
      <header className="masthead">
        <div className="masthead-brand">
          <span className="brand-title">期末复习助手</span>
          <span className="brand-sep" aria-hidden="true">
            ·
          </span>
          <span className="brand-sub">本机多课程工作台</span>
        </div>
        <CourseSwitcher
          courses={courses.length ? courses : [defaultCourse]}
          currentCourse={course}
          disabled={!courses.length}
          onSelectCourse={setId}
          onCreateCourse={handleCreateCourse}
          onRenameCourse={handleRenameCourse}
          onDeleteCourse={handleDeleteCourse}
        />
      </header>
      {courses.length > 0 && (
        <CurrentCourse.Provider value={course}>
          <Workspace
            key={course.id}
            course={course}
            draft={importDraftsByCourse[course.id] ?? EMPTY_DRAFT_FILES}
            picked={pickedByCourse[course.id] ?? EMPTY_PICKED}
            studyDraftsByScope={studyDraftsByScope}
            onUpdateDraft={(updater) => updateCourseDraft(course.id, updater)}
            onUpdatePicked={(updater) => updateCoursePicked(course.id, updater)}
            onStudyDraftChange={(version, topicId, value) =>
              handleStudyDraftChange(course.id, version, topicId, value)
            }
            onClearStudyDraft={(version, topicId) =>
              handleClearStudyDraft(course.id, version, topicId)
            }
            onCoursePublishedChange={(hasPublished) =>
              setCourses((old) =>
                old.map((c) =>
                  c.id === course.id && c.hasPublished !== hasPublished
                    ? { ...c, hasPublished }
                    : c,
                ),
              )
            }
          />
        </CurrentCourse.Provider>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
