import { useEffect, useRef, useState } from "react";
import { courseApi, errorMessage, fetchPublishedAnalysis } from "./api";
import type { Snapshot } from "./types";

const labels = {
  pending: "等待投递", queued: "已排队", running: "分析中",
  retry: "等待重试", published: "已发布", failed: "分析失败",
};
type Task = {
  id: string; job: string; requestId: string; state: keyof typeof labels;
  reason?: string; version?: string; attempts: number;
};
const active = (task?: Task) => Boolean(task && task.state !== "published" && task.state !== "failed");

export function useAnalysisTask(base: string, job: string, onPublished: (snapshot: Snapshot) => void) {
  const [task, setTask] = useState<Task>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [tick, refresh] = useState(0);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const generation = useRef(0);
  const tracked = useRef("");
  const seen = useRef("");
  const publish = useRef(onPublished);
  publish.current = onPublished;
  const key = "analysis-request:" + base + "/" + job;

  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    tracked.current = "";
    seen.current = "";
    setTask(undefined);
    setError("");
    setSending(false);
    return () => { generation.current++; };
  }, [base, job]);

  useEffect(() => {
    if (!job) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const revision = sequence.current;
      let delay = 2000;
      try {
        const path = tracked.current ? "analysis-tasks/" + tracked.current : "jobs/" + job + "/analysis-tasks";
        const found = await courseApi<Task | undefined>(base, path);
        if (!live || revision !== sequence.current) return;
        setTask(found);
        if (found && localStorage.getItem(key) === found.requestId) localStorage.removeItem(key);
        if (found && active(found)) {
          tracked.current = found.id;
          delay = 800;
        } else {
          tracked.current = "";
        }
        if (found?.version && seen.current !== found.version) {
          const snapshot = await fetchPublishedAnalysis(base);
          if (!live || revision !== sequence.current) return;
          if (snapshot) publish.current(snapshot);
          seen.current = found.version;
        }
        setError(localStorage.getItem(key) ? "上次提交尚未确认，可以再次提交找回任务。" : "");
      } catch (e) {
        if (live && revision === sequence.current) setError(errorMessage(e) + "，正在重新连接");
      } finally {
        if (live) timer = setTimeout(poll, delay);
      }
    }
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [base, job, key, tick]);

  async function submit() {
    if (!job || inFlight.current || active(task)) return;
    inFlight.current = true;
    const scope = generation.current;
    sequence.current++;
    setSending(true);
    setError("");
    const requestId = localStorage.getItem(key) || crypto.randomUUID();
    localStorage.setItem(key, requestId);
    try {
      const response = await fetch(base + "/jobs/" + job + "/analysis-tasks", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Review-Request": "1" },
        body: JSON.stringify({ requestId }),
      });
      if (response.status !== 202 && response.status !== 409) throw Error("提交未确认，请重试");
      const result: Task = await response.json();
      if (!result.id) throw Error("当前批次尚不能分析");
      if (localStorage.getItem(key) === requestId) localStorage.removeItem(key);
      if (scope !== generation.current) return;
      tracked.current = result.id;
      setTask(result);
    } catch (e) {
      if (scope === generation.current) setError(errorMessage(e));
    } finally {
      if (scope === generation.current) {
        inFlight.current = false;
        sequence.current++;
        setSending(false);
        refresh(v => v + 1);
      }
    }
  }
  return { task, busy: sending || active(task), submit, error, unconfirmed: Boolean(job && localStorage.getItem(key)),
    label: task && labels[task.state] };
}
