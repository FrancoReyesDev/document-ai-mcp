export type TaskStatus = "queued" | "processing" | "completed" | "failed";
export type ToolName = "ocr_document" | "parse_form" | "parse_layout";

/** Document AI hard limit — independent of user credits. */
export const MAX_PAGES_PER_DOC = 2_000;

/** Free pages granted on account creation. */
export const FREE_PAGES = 100;

export interface CreditInfo {
  pagesAvailable: number;
  pagesUsedTotal: number;
  pagesUsedThisMonth: number;
  currentMonth: string; // "YYYY-MM"
}

export interface UserRecord {
  apiKeyHash: string;
  email: string;
  credits: CreditInfo;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface UserContext {
  apiKeyHash: string;
  email: string;
  credits: CreditInfo;
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
