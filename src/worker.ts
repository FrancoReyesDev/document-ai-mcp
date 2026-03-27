import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { getUserByApiKeyHash, updateTask, incrementPagesUsed, checkAndResetQuota } from "./storage/index.js";
import { getDocumentAIClient, PROCESSORS, processDocument, formatOcrToMarkdown, formatFormToMarkdown, formatLayoutToMarkdown, countPdfPages } from "./documentai/index.js";
import { splitMarkdownPages } from "./documentai/split-pages.js";
import { uploadPagedResult, getPageCountFromMetadata, downloadGcsFile } from "./gcs/index.js";
import type { ToolName, DocumentInput } from "./types.js";
import { PLAN_MAX_PAGES_PER_DOC } from "./types.js";

const oidcClient = new OAuth2Client();

interface WorkerPayload {
  taskId: string;
  userId: string;
  toolName: ToolName;
  input: DocumentInput;
}

const FORMATTERS: Record<ToolName, (doc: unknown) => string> = {
  ocr_document: formatOcrToMarkdown as (doc: unknown) => string,
  parse_form: formatFormToMarkdown as (doc: unknown) => string,
  parse_layout: formatLayoutToMarkdown as (doc: unknown) => string,
};

const PROCESSOR_KEYS: Record<ToolName, keyof typeof PROCESSORS> = {
  ocr_document: "ocr",
  parse_form: "formParser",
  parse_layout: "layoutParser",
};

async function verifyOidc(req: Request): Promise<boolean> {
  const saEmail = process.env.WORKER_SA_EMAIL;
  if (!saEmail) return true;

  const authHeader = req.headers["authorization"] as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) return false;

  try {
    const token = authHeader.slice(7);
    await oidcClient.verifyIdToken({ idToken: token, audience: process.env.SERVICE_URL });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the page count of the input document.
 * Uses GCS metadata if available, otherwise downloads and counts.
 */
async function resolvePageCount(input: DocumentInput): Promise<number> {
  // Try GCS metadata first (set by upload_document)
  if (input.gcsUri) {
    const fromMeta = await getPageCountFromMetadata(input.gcsUri);
    if (fromMeta > 0) return fromMeta;

    // Fallback: download and count
    const buffer = await downloadGcsFile(input.gcsUri);
    return countPdfPages(buffer);
  }

  if (input.content) {
    return await countPdfPages(Buffer.from(input.content, "base64"));
  }

  if (input.url) {
    const response = await fetch(input.url);
    if (!response.ok) throw new Error(`Failed to fetch ${input.url}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return countPdfPages(buffer);
  }

  return 0;
}

export async function handleWorker(req: Request, res: Response): Promise<void> {
  if (!(await verifyOidc(req))) {
    res.status(401).json({ error: "Unauthorized: invalid OIDC token" });
    return;
  }

  const payload = req.body as WorkerPayload;
  const { taskId, userId, toolName, input } = payload;

  try {
    await updateTask(taskId, { status: "processing" });

    // Get user plan for limits
    const user = await getUserByApiKeyHash(userId);
    if (!user) throw new Error("User not found");

    // Count pages before processing
    const pageCount = await resolvePageCount(input);

    // Check hard limit per document
    const maxPages = PLAN_MAX_PAGES_PER_DOC[user.plan];
    if (pageCount > maxPages) {
      throw new Error(`Document has ${pageCount} pages, exceeds plan limit of ${maxPages}. Upgrade your plan.`);
    }

    // Check remaining quota
    const quota = await checkAndResetQuota(userId);
    const remaining = quota.monthlyPages - quota.pagesUsed;
    if (pageCount > remaining) {
      throw new Error(`Document has ${pageCount} pages but you only have ${remaining} pages left this month.`);
    }

    // Process
    const client = getDocumentAIClient();
    const processorName = PROCESSORS[PROCESSOR_KEYS[toolName]];
    if (!processorName) throw new Error(`Processor not configured for ${toolName}`);

    const document = await processDocument(client, processorName, input, userId);
    const formatter = FORMATTERS[toolName];
    const markdown = formatter(document);
    const pages = splitMarkdownPages(markdown);

    const { resultPrefix } = await uploadPagedResult(taskId, pages);
    await incrementPagesUsed(userId, pages.length);

    await updateTask(taskId, {
      status: "completed",
      resultGcsUri: resultPrefix,
      completedAt: new Date(),
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTask(taskId, { status: "failed", error: message, completedAt: new Date() }).catch(() => {});
    res.status(500).json({ error: message });
  }
}
