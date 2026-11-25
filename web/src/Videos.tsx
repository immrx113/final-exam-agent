import { useEffect, useState } from "react";

type Item = {
  url: string; title: string; target: string; topics: string[];
  views: number | null; likes: number | null; favorites: number | null;
};
type State = { status: string; reason: string; items: Item[] };

export function Videos({version}: {version: string}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const url = "/api/course/versions/" + version + "/videos";
    async function load(retry: boolean) {
      try {
        const response = await fetch(url + (retry ? "/retry" : ""), {
          signal: controller.signal, method: retry ? "POST" : "GET",
          headers: retry ? {"X-Review-Request":"1"} : {}
        });
        if (!response.ok) throw Error();
        const data: State = await response.json();
        if (controller.signal.aborted) return;
        setState(data);
        if (["queued","running"].includes(data.status)) timer = setTimeout(() => void load(false), 1000);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load(attempt > 0);
    return () => {controller.abort(); clearTimeout(timer);};
  }, [version, attempt]);
  const pending = !error && (!state || ["queued","running"].includes(state.status));
  const metric = (value: number | null) => value?.toLocaleString() ?? "未取得";
  return <section aria-label="B 站参考视频">
    <h3>B 站参考视频</h3>
    <p role="status">{error ? "暂时无法读取推荐" : pending ? "正在检索参考视频…" : state?.reason}</p>
    {state && state.items.length > 0 && <ul>{state.items.map(v => <li key={v.url}>
      <a href={v.url} target="_blank" rel="noreferrer">{v.title}</a> · {v.target}
      <div>对应知识点：{v.topics.join("、")}</div>
      <div>整条视频 · 播放 {metric(v.views)} · 点赞 {metric(v.likes)} · 收藏 {metric(v.favorites)}</div>
    </li>)}</ul>}
    {(error || state?.status === "failed" || state?.status === "partial") &&
      <button onClick={() => {setError(false); setState(null); setAttempt(a => a+1);}}>重试视频检索</button>}
  </section>;
}
