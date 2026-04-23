export type TaskStatus = "queued" | "processing" | "completed" | "failed";
export type ToolName = "ocr_document" | "parse_form" | "parse_layout";

/** Document AI hard limit — independent of user credits. */
export const MAX_PAGES_PER_DOC = 2_000;

export interface CreditInfo {
  pagesAvailable: number;
  pagesUsedTotal: number;
  pagesUsedThisMonth: number;
  currentMonth: string; // "YYYY-MM"
}

export interface UserRecord {
  userId: string;
  githubId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  credits: CreditInfo;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface UserContext {
  userId: string;
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
  /** Conocido solo una vez que el worker lo resolvió. */
  pageCount?: number;
  /** Timestamp en que el worker empezó el processing real (tras validaciones). */
  startedAt?: Date;
  /** TTL — Firestore auto-borra cuando este campo < now. Seteado en createTask a +90 días. */
  expiresAt?: Date;
}
