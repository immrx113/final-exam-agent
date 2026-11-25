import { useEffect, useState, type ReactNode } from "react";
import type { Topic } from "./Analysis";

type State = { topic: string; revision: number; completed: boolean; note: string };
type Fields = { completed?: boolean; note?: string };

function StudyItem({ row, initial, url, children }: {
  row: Topic; initial?: State; url: string; children: ReactNode;
}) {
  const [state, setState] = useState<State>(initial ?? {topic: row.id, revision: 0, completed: false, note: ""});
  const [draft, setDraft] = useState(state.note);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  async function save(fields: Fields) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(url + "/" + row.id, { method: "PUT",
        headers: {"Content-Type": "application/json", "X-Review-Request": "1"},
        body: JSON.stringify({ revision: state.revision, ...fields }) });
      if (response.status === 409) {
        const latest: State = await response.json();
        setState(latest);
        setConflict(true);
        setMessage("其他页面已更新此项，请核对已保存的笔记后再保存。");
        return;
      }
      if (!response.ok) throw Error();
      const latest: State = await response.json();
      setState(latest);
      if (fields.note !== undefined) setConflict(false);
      setMessage("已保存");
    } catch {
      setMessage("保存失败，输入已保留，请重试。");
    } finally { setSaving(false); }
  }
  return <article className="study-item">
    {children}
    <p>{row.topic.chapter}</p>
    <label><input type="checkbox" checked={state.completed} disabled={saving}
      onChange={e => void save({completed: e.target.checked})}/> 已完成 · {row.topic.name}</label>
    <div className="study-note">
      <label htmlFor={"note-" + row.id}>学习笔记 · {row.topic.name}</label>
      <textarea id={"note-" + row.id} rows={3} value={draft} onChange={e => setDraft(e.target.value)}/>
    </div>
    {conflict && <p>已保存的笔记：{state.note || "（空）"}</p>}
    <button disabled={saving || (draft === state.note && !conflict)} onClick={() => void save({note: draft})}>保存笔记</button>
    <span role="status"> {message}</span>
  </article>;
}

export function Study({rows, version, detail}: {rows: Topic[]; version: string; detail: (r: Topic) => ReactNode}) {
  const [states, setStates] = useState<Map<string,State> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const url = "/api/course/versions/" + version + "/states";
  useEffect(() => {
    let active = true;
    setFailed(false);
    fetch(url).then(async response => {
      if (!response.ok) throw Error();
      const data: State[] = await response.json();
      if (active) setStates(new Map(data.map(s => [s.topic,s])));
    }).catch(() => { if (active) setFailed(true); });
    return () => {active = false;};
  }, [url,attempt]);
  if (failed) return <p role="alert">读取学习记录失败。 <button onClick={() => setAttempt(n => n+1)}>重试</button></p>;
  if (!states) return <p>正在读取学习记录…</p>;
  return <>{rows.map(row => <StudyItem key={row.id} row={row} initial={states.get(row.id)} url={url}>{detail(row)}</StudyItem>)}</>;
}
