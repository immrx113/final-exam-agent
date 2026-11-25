import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Analysis } from "./Analysis";

const roles = { courseware: "课件", material: "资料", exam: "试卷" } as const;
type Role = keyof typeof roles;
type Draft = { key: string; file: File; role: Role };
type Saved = { id: string; name: string; role: Role };
type Item = {
  file: string;
  name: string;
  role: Role;
  status: "queued" | "processing" | "ready" | "failed" | "recheck" | "rechecking";
  reason: string | null;
};
type Source = {
  id: string;
  pos: number;
  body: string;
  review: boolean;
  label: string;
  url: string;
};
const labels = {
  queued: "排队中",
  processing: "处理中",
  recheck: "等待重新识别",
  rechecking: "正在重新识别",
  ready: "已完成",
  failed: "处理失败",
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch("/api/course/" + path, {
    ...init,
    headers: { "X-Review-Request": "1", ...init.headers },
  });
  if (!r.ok) {
    const msg: Record<number, string> = {
      400: "请检查文件、名称和用途",
      413: "文件超过 50 MB",
      415: "暂不支持此格式",
      503: "存储服务暂不可用",
    };
    throw new Error(msg[r.status] ?? "请求失败（" + r.status + "）");
  }
  const text = await r.text();
  return text ? JSON.parse(text) : undefined;
}
function message(e: unknown) {
  return e instanceof Error ? e.message : "连接失败，请重试";
}

function Evidence({ job, item }: { job: string; item: Item }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState("");
  async function toggle() {
    if (sources) {
      setSources(null);
      return;
    }
    try {
      setSources(
        await api<Source[]>("jobs/" + job + "/" + item.file + "/segments"),
      );
      setError("");
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <>
      <button className="sub" onClick={toggle}>
        {sources ? "收起片段" : "查看文本与来源"}
      </button>
      {error && <p role="alert">{error}</p>}
      {sources?.map((s) => (
        <section className="source" key={s.id}>
          <a href={s.url} target="_blank" rel="noreferrer">
            {item.name} · {s.label} ↗
          </a>
          {s.review && <strong>待核对</strong>}
          <pre>{s.body || "未取得可读文本，请打开原页核对。"}</pre>
        </section>
      ))}
    </>
  );
}

function App() {
  const [draft, setDraft] = useState<Draft[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [jobs, setJobs] = useState<string[]>([]);
  const [job, setJob] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [tick, setTick] = useState(0);
  const [reload, setReload] = useState(0);
  function selectJob(id: string) {
    setItems([]);
    setJob(id);
    sessionStorage.setItem("selected-job", id);
  }
  useEffect(() => {
    let live = true;
    Promise.all([api<Saved[]>("files"), api<string[]>("jobs")])
      .then(([f, j]) => {
        if (live) {
          setSaved(f);
          setJobs(j);
          const last = sessionStorage.getItem("selected-job") || "";
          selectJob(j.includes(last) ? last : j[0] || "");
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [reload]);
  useEffect(() => {
    if (!job) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const v = await api<Item[]>("jobs/" + job);
        if (!active) return;
        setItems(v);
        setPollError("");
        if (v.every((i) => i.status === "ready" || i.status === "failed"))
          return;
      } catch (e) {
        if (active) setPollError(message(e));
      }
      if (active) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job, tick]);
  async function submit() {
    setBusy(true);
    setError("");
    const ids = new Set(picked),
      added: Saved[] = [],
      failed: Draft[] = [],
      errors: string[] = [];
    try {
      for (const d of draft) {
        const body = new FormData();
        body.append("file", d.file);
        body.append("role", d.role);
        try {
          const { id } = await api<{ id: string }>("files", {
            method: "POST",
            body,
          });
          ids.add(id);
          added.push({ id, name: d.file.name, role: d.role });
        } catch (e) {
          failed.push(d);
          errors.push(d.file.name + "：" + message(e));
        }
      }
      setDraft(failed);
      setPicked([...ids]);
      setSaved((old) =>
        Array.from(new Map([...old, ...added].map((f) => [f.id, f])).values()),
      );
      if (ids.size) {
        const { id } = await api<{ id: string }>("jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: [...ids] }),
        });
        setJobs((j) => (j.includes(id) ? j : [id, ...j]));
        selectJob(id);
        setTick((n) => n + 1);
        setPicked([]);
      }
    } catch (e) {
      errors.push(message(e));
    } finally {
      setError(errors.join("\n"));
      setBusy(false);
    }
  }
  async function retry(file: string, action = "retry") {
    try {
      await api("jobs/" + job + "/" + file + "/" + action, { method: "POST" });
      setTick((v) => v + 1);
      setError("");
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <main>
      <header>
        <span>期末复习助手</span>
        <span>课程资料</span>
      </header>
      <h1>数据库原理</h1>
      <h2>导入文件</h2>
      <p className="hint">
        按用途选择文件，可在提交前调整归类。支持 PDF、Office、Markdown、JPG 和
        PNG，每份最多 50 MB。
      </p>
      <fieldset disabled={busy}>
        <div className="zones">
          {(Object.keys(roles) as Role[]).map((role) => (
            <section className="zone" key={role}>
              <h3>{roles[role]}</h3>
              <label className="picker">
                选择{roles[role]}
                <input
                  type="file"
                  multiple
                  accept=".ppt,.pptx,.doc,.docx,.md,.pdf,.png,.jpg,.jpeg"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    setDraft((v) => [
                      ...v,
                      ...files.map((file) => ({
                        key: crypto.randomUUID(),
                        file,
                        role,
                      })),
                    ]);
                    e.target.value = "";
                  }}
                />
              </label>
              {draft
                .filter((f) => f.role === role)
                .map((f) => (
                  <div className="draft" key={f.key}>
                    <b>{f.file.name}</b>
                    <select
                      aria-label={f.file.name + "的用途"}
                      value={f.role}
                      onChange={(e) =>
                        setDraft((v) =>
                          v.map((d) =>
                            d.key === f.key
                              ? { ...d, role: e.target.value as Role }
                              : d,
                          ),
                        )
                      }
                    >
                      {Object.entries(roles).map(([r, t]) => (
                        <option key={r} value={r}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <button
                      className="sub"
                      onClick={() =>
                        setDraft((v) => v.filter((d) => d.key !== f.key))
                      }
                    >
                      移除
                    </button>
                  </div>
                ))}
            </section>
          ))}
        </div>
        {saved.length > 0 && (
          <details>
            <summary>已上传文件（{saved.length}）</summary>
            {saved.map((f) => (
              <div key={f.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.includes(f.id)}
                    onChange={(e) =>
                      setPicked((v) =>
                        e.target.checked
                          ? [...v, f.id]
                          : v.filter((id) => id !== f.id),
                      )
                    }
                  />
                  {roles[f.role]} · {f.name}
                </label>{" "}
                <a href={"/api/course/files/" + f.id + "/original"}>下载原件</a>
              </div>
            ))}
          </details>
        )}
        <button
          className="primary"
          disabled={!draft.length && !picked.length}
          onClick={submit}
        >
          {busy ? "正在提交…" : "提交处理"}
        </button>
      </fieldset>
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="sub" onClick={() => setReload((v) => v + 1)}>
            刷新课程
          </button>
        </p>
      )}
      {jobs.length > 0 && (
        <section>
          <div className="bar">
            <h2>处理结果</h2>
            <select
              aria-label="处理批次"
              value={job}
              onChange={(e) => selectJob(e.target.value)}
            >
              {jobs.map((j, i) => (
                <option value={j} key={j}>
                  第 {jobs.length - i} 批
                </option>
              ))}
            </select>
          </div>
          {pollError && <p role="alert">{pollError}，正在重新连接</p>}
          {job && <Analysis key={job} job={job} ready={!busy && items.some(i => i.status === "ready") && items.every(i => i.status === "ready" || i.status === "failed")} />}
          {items.map((i) => (
            <article key={job + i.file}>
              <div className="bar">
                <b>{i.name}</b>
                <span>
                  {roles[i.role]} · {labels[i.status]}
                </span>
              </div>
              <a href={"/api/course/files/" + i.file + "/original"}>下载原件</a>
              {i.status === "failed" && (
                <p>
                  {i.reason}{" "}
                  <button onClick={() => retry(i.file)}>重试此文件</button>
                </p>
              )}
              {i.status === "ready" && <>
                <Evidence job={job} item={i} />
                {/\.(pdf|pptx?|docx?)$/i.test(i.name) && <button className="sub" onClick={() => retry(i.file, "recheck")}>重新识别正文</button>}
                {i.reason && <p role="alert">{i.reason}</p>}
              </>}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
