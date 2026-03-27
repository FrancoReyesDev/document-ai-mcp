import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { updateTask, incrementPagesUsed } from "./storage/index.js";
import { getDocumentAIClient, PROCESSORS, processDocument, formatOcrToMarkdown, formatFormToMarkdown, formatLayoutToMarkdown } from "./documentai/index.js";
import { splitMarkdownPages } from "./documentai/split-pages.js";
import { uploadPagedResult } from "./gcs/index.js";
import type { ToolName, DocumentInput } from "./types.js";

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

/**
 * Verifies the OIDC token from Cloud Tasks.
 * Skips verification if WORKER_SA_EMAIL is not configured (dev mode).
 */
async function verifyOidc(req: Request): Promise<boolean> {
  const saEmail = process.env.WORKER_SA_EMAIL;
  if (!saEmail) return true; // Dev mode: skip verification

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
 * Worker endpoint called by Cloud Tasks.
 * Verifies OIDC token, then processes a document using the shared client.
 */
export async function handleWorker(req: Request, res: Response): Promise<void> {
  if (!(await verifyOidc(req))) {
    res.status(401).json({ error: "Unauthorized: invalid OIDC token" });
    return;
  }

  const payload = req.body as WorkerPayload;
  const { taskId, userId, toolName, input } = payload;

  try {
    await updateTask(taskId, { status: "processing" });

    const client = getDocumentAIClient();
    const processorName = PROCESSORS[PROCESSOR_KEYS[toolName]];

    if (!processorName) throw new Error(`Processor not configured for ${toolName}`);

    const document = await processDocument(client, processorName, input, userId);

    const formatter = FORMATTERS[toolName];
    const markdown = formatter(document);
    const pages = splitMarkdownPages(markdown);

    const { resultPrefix } = await uploadPagedResult(taskId, pages);

    // Track quota usage
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
