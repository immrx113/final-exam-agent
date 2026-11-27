import { createContext, useContext } from "react";
import type { CourseSummary, Snapshot } from "./types";

export const defaultCourse: CourseSummary = { id: "default", name: "数据库原理", hasPublished: false };
export const CurrentCourse = createContext(defaultCourse);
export function useCourseBase() {
  const { id } = useContext(CurrentCourse);
  return id === "default" ? "/api/course" : "/api/courses/" + encodeURIComponent(id);
}

export async function listCourses(): Promise<CourseSummary[]> {
  try {
    const response = await fetch("/api/courses");
    if (response.ok) {
      const rows: unknown = await response.json();
      if (Array.isArray(rows) && rows.some(c => c?.id === "default") &&
          rows.every(c => typeof c?.id === "string" && typeof c.name === "string")) return rows;
    }
  } catch { /* The single-course UI can also run against a legacy server. */ }
  return [defaultCourse];
}

export async function createCourse(name: string): Promise<CourseSummary> {
  const response = await fetch("/api/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Review-Request": "1" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(response.status === 409 ? "同名课程已存在" :
    response.status === 400 ? "请检查课程名称" : "课程创建失败，请重试");
  return response.json();
}


const COURSE_STATUS_MESSAGES: Record<number, string> = {
  400: "请检查文件、名称和用途",
  413: "文件超过 50 MB",
  415: "暂不支持此格式",
  503: "存储服务暂不可用",
};

export async function courseApi<T>(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(base + "/" + path, {
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

export async function fetchPublishedAnalysis(base: string): Promise<Snapshot | null> {
  const response = await fetch(base + "/analysis");
  if (!response.ok) {
    throw new Error("课程分析暂不可用，请重试");
  }
  return (await response.json()) as Snapshot | null;
}

export async function runBatchAnalysis(base: string, jobId: string): Promise<Snapshot> {
  const response = await fetch(`${base}/jobs/${jobId}/analysis`, {
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
