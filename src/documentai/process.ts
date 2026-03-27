import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { google } from "@google-cloud/documentai/build/protos/protos.js";
import { batchProcess } from "./batch-process.js";
import type { DocumentInput } from "../types.js";

type IDocument = google.cloud.documentai.v1.IDocument;

/**
 * Processes a document with Document AI.
 * Tries online first; falls back to batch if the document exceeds online limits.
 */
export async function processDocument(
  client: DocumentProcessorServiceClient,
  processorName: string,
  input: DocumentInput,
  userApiKeyHash: string,
): Promise<IDocument> {
  try {
    return await processOnline(client, processorName, input);
  } catch (error) {
    if (isBatchFallbackError(error)) {
      return batchProcess(client, processorName, input, userApiKeyHash);
    }
    throw error;
  }
}

async function processOnline(
  client: DocumentProcessorServiceClient,
  processorName: string,
  input: DocumentInput,
): Promise<IDocument> {
  const request = await buildRequest(processorName, input);
  const [result] = await client.processDocument(request);

  if (!result.document) {
    throw new Error("Document AI returned no document in response");
  }

  return result.document;
}

function isBatchFallbackError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /pages?.*(exceed|limit)/i.test(msg) || /document.*size.*exceed/i.test(msg);
}

async function buildRequest(
  processorName: string,
  input: DocumentInput,
): Promise<google.cloud.documentai.v1.IProcessRequest> {
  if (input.content && input.mimeType) {
    return {
      name: processorName,
      rawDocument: { content: input.content, mimeType: input.mimeType },
    };
  }

  if (input.gcsUri) {
    return {
      name: processorName,
      gcsDocument: { gcsUri: input.gcsUri, mimeType: input.mimeType ?? "application/pdf" },
    };
  }

  if (input.url) {
    const { content, mimeType } = await fetchDocumentFromUrl(input.url);
    return {
      name: processorName,
      rawDocument: { content, mimeType },
    };
  }

  throw new Error("Invalid input: provide content+mimeType, gcsUri, or url");
}

/**
 * Fetches a document from a URL and returns it as base64.
 * Exported for reuse by batch-process.ts.
 */
export async function fetchDocumentFromUrl(
  url: string,
): Promise<{ content: string; mimeType: string }> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch document from URL: ${response.status} ${response.statusText}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "application/pdf";
  const buffer = await response.arrayBuffer();
  const content = Buffer.from(buffer).toString("base64");

  return { content, mimeType };
}
