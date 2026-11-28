import { useEffect, useRef, useState, type ReactNode } from "react";
import { courseApi, useCourseBase } from "./api";
import type { Snapshot } from "./types";

type Edit = { question: number; requirement: number; refs: string[]; matches: string[] };
type Draft = { requestId: string; edits: Edit[] };
type Edition = { version: string; parent: string | null };
type Target = { question: number; requirement: number };

function readDraft(key: string): Draft {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) || "null");
    if (stored?.requestId && Array.isArray(stored.edits)) return stored;
  } catch { /* An unavailable tab store still allows editing in memory. */ }
  return { requestId: crypto.randomUUID(), edits: [] };
}

export function Corrections({ snapshot, onRead, target, evidence }: {
  snapshot: Snapshot; onRead: (s: Snapshot) => void; target?: Target;
  evidence: (ref: string, key: string) => ReactNode;
}) {
  const base = useCourseBase();
  const storage = base + "/correction-draft/" + snapshot.version;
  const [draft, setDraft] = useState(() => readDraft(storage));
  const [editions, setEditions] = useState<Edition[]>([]);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [qi, setQuestion] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [latest, setLatest] = useState("");
  const panel = useRef<HTMLDetailsElement>(null);
  const live = useRef(true);
  const questions = snapshot.questions;
  const q = questions?.[qi];

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    courseApi<Edition[]>(base, "versions").then(rows => {
      if (active) { setEditions(rows); setLoadFailed(false); }
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [base, loadAttempt]);
  useEffect(() => {
    if (target && panel.current) {
      setExpanded(true);
      setQuestion(target.question);
      const frame = requestAnimationFrame(() => document.getElementById("requirement-" + target.requirement)?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [target]);

  function saveDraft(edits: Edit[]) {
    const next = { requestId: crypto.randomUUID(), edits };
    setDraft(next);
    try {
      if (edits.length) sessionStorage.setItem(storage, JSON.stringify(next));
      else sessionStorage.removeItem(storage);
    } catch { /* Keep this page's in-memory draft. */ }
    setMessage("");
  }
  function change(ri: number, matches: string[]) {
    if (!q) return;
    const r = q.requirements[ri];
    const edits = draft.edits.filter(e => e.question !== qi || e.requirement !== ri);
    if (r.pending || matches.length !== r.matches.length || matches.some(m => !r.matches.includes(m)))
      edits.push({ question: qi, requirement: ri, refs: r.refs, matches });
    saveDraft(edits);
  }
  async function read(id: string) {
    setBusy(true);
    try {
      const result = await courseApi<Snapshot>(base, "versions/" + id);
      if (live.current) onRead(result);
    } catch { if (live.current) setMessage("版本读取失败，请重试"); }
    finally { if (live.current) setBusy(false); }
  }
  async function publish() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(base + "/versions/" + snapshot.version + "/corrections", {
        method: "POST", headers: {"X-Review-Request": "1", "Content-Type": "application/json"},
        body: JSON.stringify(draft),
      });
      if (!live.current) return;
      if (response.status === 409) {
        const conflict = await response.json();
        setMessage(conflict.reason + "。本页修改已保留。");
        setLatest(conflict.latest === snapshot.version ? "" : conflict.latest);
        return;
      }
      if (!response.ok) throw Error();
      const result = await response.json() as Snapshot;
      if (live.current) { saveDraft([]); onRead(result); }
    } catch { if (live.current) setMessage("发布尚未确认，保留修改，可重试同一次提交。"); }
    finally { if (live.current) setBusy(false); }
  }
  const summary = (n: number) => {
    const question = questions![n];
    return (snapshot.sources[question.refs[0]]?.name || "试卷") + " · 第 " + question.label + " 题";
  };
  const names = (items: string[]) => items.join("、") || "无关联";

  return <div className="correction-tools">
    {editions.length > 0 && <label>阅读版本 <select aria-label="阅读版本" value={snapshot.version} disabled={busy}
      onChange={e => void read(e.target.value)}>{editions.map((v, i) =>
        <option key={v.version} value={v.version}>{i === 0 ? "最新 · " : ""}{v.parent ? "人工修正版" : "分析原版"} #{v.version.slice(0, 8)}</option>
      )}</select></label>}
    {loadFailed && <button className="sub" onClick={() => setLoadAttempt(x => x + 1)}>重试读取版本列表</button>}
    {snapshot.correction && questions && <details><summary>本版修正记录（{snapshot.correction.changes.length}）</summary>
      <p>基于 #{snapshot.correction.parent.slice(0, 8)} · {new Date(snapshot.correction.time).toLocaleString()}</p>
      {snapshot.correction.changes.map(c => <div key={c.question + "/" + c.requirement}>
        <strong>{summary(c.question)}</strong> · {questions[c.question].requirements[c.requirement].text}
        <p>{c.wasPending ? "待核对" : names(c.before)} → {names(c.after)}</p>
        {questions[c.question].requirements[c.requirement].refs.map(ref => evidence(ref, "audit:" + c.question + ":" + c.requirement + ":" + ref))}
      </div>)}</details>}
    {!questions ? <p className="hint">此版本缺少逐项作答记录。重新分析本批资料后可修正考点。</p> :
      q && <details ref={panel} open={expanded} onToggle={e => setExpanded(e.currentTarget.open)} className="correction-editor">
        <summary>核对与修正考点{draft.edits.length > 0 && "（有未发布修改）"}</summary>
        {expanded && <fieldset disabled={busy}><label>选择原题 <select value={qi} onChange={e => setQuestion(Number(e.target.value))}>
          {questions.map((_, n) => <option key={n} value={n}>{summary(n)}</option>)}</select></label>
          {q.requirements.map((r, ri) => {
            const edit = draft.edits.find(e => e.question === qi && e.requirement === ri);
            const chosen = edit?.matches ?? r.matches;
            return <section key={qi + "/" + ri} tabIndex={-1} id={"requirement-" + ri} className="requirement">
              <strong>{r.text}</strong><p>{r.pending ? "待核对 · " : ""}{r.reason}</p>
              {r.refs.map(ref => evidence(ref, "correct:" + qi + ":" + ri + ":" + ref))}
              <div className="topic-choices">{snapshot.ranked.map(({topic}) =>
                <label key={topic.name}><input type="checkbox" checked={chosen.includes(topic.name)}
                  onChange={e => change(ri, e.target.checked ? [...chosen, topic.name] : chosen.filter(n => n !== topic.name))}/>
                  {topic.name}{r.candidates.includes(topic.name) && "（候选）"}</label>)}</div>
              {r.pending && <button className="sub" onClick={() => change(ri, [])}>确认无相应考点</button>}
            </section>;
          })}
          {draft.edits.length > 0 && <div className="correction-preview"><strong>待发布修改</strong>
            {draft.edits.map(e => <p key={e.question + "/" + e.requirement}>{summary(e.question)} ·
              {questions[e.question].requirements[e.requirement].text} · {names(questions[e.question].requirements[e.requirement].matches)} → {names(e.matches)}</p>)}
            <button onClick={() => void publish()}>确认并发布修正版</button>{" "}
            <button className="sub" onClick={() => saveDraft([])}>放弃本次修改</button>
          </div>}
        </fieldset>}
      </details>}
    {message && <p role="status">{message} {latest && <button className="sub" onClick={() => void read(latest)}>查看最新版本</button>}</p>}
  </div>;
}
