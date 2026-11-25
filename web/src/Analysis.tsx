import { useEffect, useRef, useState } from "react";

type Question = { label: string; refs: string[] };
type Topic = {
  id: string;
  outlineOrder?: number;
  topic: { name: string; chapter: string; text: string; refs: string[] };
  count: number;
  papers: number;
  questions: Question[];
};
type Snapshot = {
  job: string;
  version: string;
  paperCount: number;
  ranked: Topic[];
  sources: Record<string, { name: string; label: string; url: string }>;
  reviews: { reason: string; refs: string[] }[];
};

export function Analysis({ job, ready }: { job: string; ready: boolean }) {
  const [result, setResult] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("rank");
  const generation = useRef(0);
  async function load(run: boolean) {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/course/" + (run ? "jobs/" + job + "/analysis" : "analysis"),
        run ? { method: "POST", headers: { "X-Review-Request": "1" } } : {});
      if (!response.ok) throw Error(response.status === 504 ? "分析超时，请重试" :
        response.status === 502 ? "分析失败，请检查 Python 环境并重试" : "课程分析暂不可用，请重试");
      const data = await response.json();
      if (token === generation.current) setResult(data);
    } catch (e) {
      if (token === generation.current) setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load(false);
    return () => { generation.current++; };
  }, [job]);

  function links(refs: string[]) {
    return refs.map(id => {
      const s = result!.sources[id];
      return <a className="evidence-link" key={id} href={s.url} target="_blank" rel="noreferrer">{s.name} · {s.label}</a>;
    });
  }
  function detail(row: Topic) {
    return <details key={row.id} className="topic">
      <summary><strong>{row.topic.name}</strong>{" · "}{result!.paperCount
        ? row.count + " 题 · " + row.papers + "/" + result!.paperCount + " 份卷"
        : "暂无试卷统计"}</summary>
      <p>{row.topic.chapter} · {row.topic.text}</p>
      {!!row.topic.refs.length && <p>教学出处 {links(row.topic.refs)}</p>}
      {!!row.questions.length && <ol>{row.questions.map(q =>
        <li key={q.refs[0] + q.label}>第 {q.label} 题 {links(q.refs)}</li>)}</ol>}
    </details>;
  }
  const visible = result?.paperCount ? result.ranked.filter(row => row.count > 0) : result?.ranked ?? [];
  const outline = [...visible].sort((a,b) => (a.outlineOrder ?? 0) - (b.outlineOrder ?? 0));
  return <section aria-label="课程分析">
    <div className="bar"><h2>课程分析</h2>
      <button className="primary" disabled={!ready || busy} onClick={() => load(true)}>
        {busy ? "正在读取或分析…" : "分析本批资料"}
      </button>
    </div>
    {error && <p role="alert">{error} <button onClick={() => load(false)}>读取上次结果</button></p>}
    {result && <>
      <p className="hint">{result.job === job ? "当前批次" : "上次发布的批次"} · {visible.length} 个知识点 · {result.paperCount ? "纳入 " + result.paperCount + " 份试卷" : "暂无试卷统计"}</p>
      <label>查看方式 <select value={view} onChange={e => setView(e.target.value)}>
        <option value="rank">真题频次</option><option value="chapters">章节目录</option>
      </select></label>
      {view === "rank" ? visible.map(detail) : Array.from(new Set(outline.map(r => r.topic.chapter))).map(chapter =>
        <section key={chapter}><h3>{chapter}</h3>{outline.filter(r => r.topic.chapter === chapter).map(detail)}</section>)}
      {!visible.length && <p>{result.paperCount ? "本批试卷暂无已确认命中的知识点。" : "未提取到有依据的知识点。"}</p>}
      {!!result.reviews.length && <details><summary>待核对（{result.reviews.length}）</summary>
        <ul>{result.reviews.map((r,i) => <li key={i}>{r.reason} {links(r.refs)}</li>)}</ul>
      </details>}
    </>}
  </section>;
}
