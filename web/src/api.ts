import type { Snapshot } from "./types";

const COURSE_STATUS_MESSAGES: Record<number, string> = {
  400: "请检查文件、名称和用途",
  413: "文件超过 50 MB",
  415: "暂不支持此格式",
  503: "存储服务暂不可用",
};

export async function courseApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/course/" + path, {
    ...init,
    headers: { "X-Review-Request": "1", ...init.headers },
  });
  if (!response.ok) {
    throw new Error(
      COURSE_STATUS_MESSAGES[response.status] ??
        `请求失败（${response.status}）`,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function fetchPublishedAnalysis(): Promise<Snapshot | null> {
  const response = await fetch("/api/course/analysis");
  if (!response.ok) {
    throw new Error("课程分析暂不可用，请重试");
  }
  return (await response.json()) as Snapshot | null;
}

export async function runBatchAnalysis(jobId: string): Promise<Snapshot> {
  const response = await fetch(`/api/course/jobs/${jobId}/analysis`, {
    method: "POST",
    headers: { "X-Review-Request": "1" },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 504
        ? "分析超时，请重试"
        : response.status === 502
          ? "分析失败，请检查 Python 环境并重试"
          : "课程分析暂不可用，请重试",
    );
  }
  return (await response.json()) as Snapshot;
}

export function errorMessage(error: unknown, fallback = "连接失败，请重试"): string {
  return error instanceof Error ? error.message : fallback;
}
