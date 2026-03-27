export type PlanType = "free" | "basic" | "pro";
export type TaskStatus = "queued" | "processing" | "completed" | "failed";
export type ToolName = "ocr_document" | "parse_form" | "parse_layout";

export interface QuotaInfo {
  monthlyPages: number;
  currentMonth: string;
  pagesUsed: number;
}

export interface UserRecord {
  apiKeyHash: string;
  email: string;
  plan: PlanType;
  quota: QuotaInfo;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface UserContext {
  apiKeyHash: string;
  email: string;
  plan: PlanType;
  quota: QuotaInfo;
}

export interface DocumentInput {
  content?: string;
  mimeType?: string;
  gcsUri?: string;
  url?: string;
}

export interface ResultMetadata {
  totalPages: number;
  totalChars: number;
  pages: Array<{ page: number; chars: number }>;
}

export interface ProcessingTask {
  taskId: string;
  userId: string;
  toolName: ToolName;
  input: DocumentInput;
  status: TaskStatus;
  resultGcsUri?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export const PLAN_QUOTAS: Record<PlanType, number> = {
  free: 100,
  basic: 1000,
  pro: 10000,
};

export const PLAN_MAX_PAGES_PER_DOC: Record<PlanType, number> = {
  free: 50,
  basic: 500,
  pro: 2000,
};
