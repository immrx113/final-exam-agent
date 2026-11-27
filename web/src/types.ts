export const ROLES = {
  courseware: "课件",
  material: "资料",
  exam: "试卷",
} as const;

export type Role = keyof typeof ROLES;

export type ViewMode = "rank" | "chapters" | "plan" | "study";

export type DraftFile = {
  key: string;
  file: File;
  role: Role;
};

export type SavedFile = {
  id: string;
  name: string;
  role: Role;
};

export type ItemStatus =
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "recheck"
  | "rechecking";

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  queued: "排队中",
  processing: "处理中",
  recheck: "等待重新识别",
  rechecking: "正在重新识别",
  ready: "已完成",
  failed: "处理失败",
};

export type BatchItem = {
  file: string;
  name: string;
  role: Role;
  status: ItemStatus;
  reason: string | null;
};

export type SegmentSource = {
  id: string;
  pos: number;
  body: string;
  review: boolean;
  label: string;
  url: string;
};

export type SourceRef = {
  file: string;
  name: string;
  role: Role;
  label: string;
  url: string;
  review: boolean;
};

export type Question = {
  file?: string;
  label: string;
  refs: string[];
  matches?: string[];
};

export type Topic = {
  id: string;
  outlineOrder?: number;
  topic: {
    name: string;
    chapter: string;
    text: string;
    refs: string[];
  };
  count: number;
  papers: number;
  questions: Question[];
};

export type PlanStep = {
  topic: string;
  reason: string;
  ref?: string;
};

export type ReviewItem = {
  reason: string;
  refs: string[];
};

export type Snapshot = {
  job: string;
  version: string;
  paperCount: number;
  plan?: PlanStep[];
  ranked: Topic[];
  sources: Record<string, SourceRef>;
  reviews: ReviewItem[];
};

export type StudyState = {
  topic: string;
  revision: number;
  completed: boolean;
  note: string;
};

export type ActiveEvidence = {
  key: string;
  topicId: string;
  topicName: string;
  contextLabel: string;
  fileId: string;
  fileName: string;
  locLabel: string;
  url: string;
  review: boolean;
};

export type VideoStatus =
  | "queued"
  | "running"
  | "ready"
  | "partial"
  | "failed";

export type VideoItem = {
  url: string;
  title: string;
  target: string;
  topics: string[];
  views: number | null;
  likes: number | null;
  favorites: number | null;
};

export type VideoState = {
  status: VideoStatus | string;
  reason: string;
  items: VideoItem[];
};

export function formatBatchLabel(jobs: string[], jobId: string): string {
  const index = jobs.indexOf(jobId);
  if (index >= 0) return `第 ${jobs.length - index} 批`;
  return jobId ? `批次 #${jobId.slice(0, 6)}` : "未定批次";
}

export type CourseSummary = { id: string; name: string; hasPublished: boolean };
