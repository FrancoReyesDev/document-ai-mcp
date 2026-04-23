import type { Request, Response } from "express";
import { getUserById, updateTask, consumePages, getCredits } from "./storage/index.js";
import { getDocumentAIClient, PROCESSORS, processDocument, formatOcrToMarkdown, formatFormToMarkdown, formatLayoutToMarkdown, countPdfPages } from "./documentai/index.js";
import { splitMarkdownPages } from "./documentai/split-pages.js";
import { uploadPagedResult, getPageCountFromMetadata, downloadGcsFile } from "./gcs/index.js";
import type { ToolName, DocumentInput } from "./types.js";
import { MAX_PAGES_PER_DOC } from "./types.js";

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
 * Resolves the page count of the input document.
 * Uses GCS metadata if available, otherwise downloads and counts.
 */
async function resolvePageCount(input: DocumentInput): Promise<number> {
  if (input.gcsUri) {
    const fromMeta = await getPageCountFromMetadata(input.gcsUri);
    if (fromMeta > 0) return fromMeta;

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
  const payload = req.body as WorkerPayload;
  const { taskId, userId, toolName, input } = payload;

  try {
    const user = await getUserById(userId);
    if (!user) throw new Error("User not found");

    const pageCount = await resolvePageCount(input);

    // Hard limit per document (Document AI constraint)
    if (pageCount > MAX_PAGES_PER_DOC) {
      throw new Error(`Document has ${pageCount} pages, exceeds maximum of ${MAX_PAGES_PER_DOC} pages per document.`);
    }

    // Check available credits
    const credits = await getCredits(userId);
    if (pageCount > credits.pagesAvailable) {
      throw new Error(`Document has ${pageCount} pages but you only have ${credits.pagesAvailable} pages available.`);
    }

    // Marcar processing + persistir pageCount + startedAt (para ETA en get_result)
    await updateTask(taskId, { status: "processing", pageCount, startedAt: new Date() });

    // Process
    const client = getDocumentAIClient();
    const processorName = PROCESSORS[PROCESSOR_KEYS[toolName]];
    if (!processorName) throw new Error(`Processor not configured for ${toolName}`);

    const document = await processDocument(client, processorName, input, userId);
    const formatter = FORMATTERS[toolName];
    const markdown = formatter(document);
    const pages = splitMarkdownPages(markdown);

    const { resultPrefix } = await uploadPagedResult(taskId, pages);
    await consumePages(userId, pages.length);

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
