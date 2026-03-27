import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { google } from "@google-cloud/documentai/build/protos/protos.js";
import { uploadInput, downloadOutputDocuments, deletePrefix, getOutputGcsUri } from "../gcs/index.js";
import { fetchDocumentFromUrl } from "./process.js";
import type { DocumentInput } from "../types.js";

type IDocument = google.cloud.documentai.v1.IDocument;
type IPage = google.cloud.documentai.v1.Document.IPage;

/**
 * Processes a document using Document AI batch mode.
 * Handles upload, batch request, polling, download, merge, and cleanup.
 */
export async function batchProcess(
  client: DocumentProcessorServiceClient,
  processorName: string,
  input: DocumentInput,
  userApiKeyHash: string,
): Promise<IDocument> {
  const { gcsUri: inputUri, prefix } = await resolveInputToGcs(input, userApiKeyHash);

  try {
    const outputUri = getOutputGcsUri(prefix);

    const request: google.cloud.documentai.v1.IBatchProcessRequest = {
      name: processorName,
      inputDocuments: {
        gcsDocuments: {
          documents: [{
            gcsUri: inputUri,
            mimeType: input.mimeType ?? "application/pdf",
          }],
        },
      },
      documentOutputConfig: {
        gcsOutputConfig: { gcsUri: outputUri },
      },
    };

    const [operation] = await client.batchProcessDocuments(request);
    await operation.promise();

    const shards = await downloadOutputDocuments(prefix);
    return mergeDocumentShards(shards);
  } finally {
    deletePrefix(prefix).catch(() => {});
  }
}

/**
 * Resolves any input type to a GCS URI by uploading if necessary.
 */
async function resolveInputToGcs(
  input: DocumentInput,
  userApiKeyHash: string,
): Promise<{ gcsUri: string; prefix: string }> {
  if (input.gcsUri) {
    // Already in GCS — generate a prefix for output only
    const prefix = `${userApiKeyHash}/${crypto.randomUUID()}`;
    return { gcsUri: input.gcsUri, prefix };
  }

  let content = input.content;
  let mimeType = input.mimeType ?? "application/pdf";

  if (input.url) {
    const fetched = await fetchDocumentFromUrl(input.url);
    content = fetched.content;
    mimeType = fetched.mimeType;
  }

  if (!content) {
    throw new Error("Invalid input: provide content+mimeType, gcsUri, or url");
  }

  return uploadInput(userApiKeyHash, content, mimeType);
}

import crypto from "node:crypto";

/**
 * Merges multiple document shards into a single IDocument.
 * Concatenates .text and .pages, offsetting textAnchors in subsequent shards.
 * Pure function.
 */
export function mergeDocumentShards(shards: IDocument[]): IDocument {
  if (shards.length === 0) throw new Error("No document shards to merge");
  if (shards.length === 1) return shards[0];

  let mergedText = "";
  const mergedPages: IPage[] = [];

  for (const shard of shards) {
    const shardText = shard.text ?? "";
    const offset = mergedText.length;

    if (offset > 0) {
      // Offset all textAnchors in this shard's pages
      for (const page of shard.pages ?? []) {
        offsetPageAnchors(page, offset);
      }
    }

    mergedText += shardText;
    mergedPages.push(...(shard.pages ?? []));
  }

  return { ...shards[0], text: mergedText, pages: mergedPages };
}

/**
 * Offsets all textAnchor indices in a page by a given amount.
 * Mutates the page in place.
 */
function offsetPageAnchors(page: IPage, offset: number): void {
  const walkAnchor = (anchor: google.cloud.documentai.v1.Document.ITextAnchor | null | undefined) => {
    if (!anchor?.textSegments) return;
    for (const seg of anchor.textSegments) {
      if (seg.startIndex != null) seg.startIndex = Number(seg.startIndex) + offset;
      if (seg.endIndex != null) seg.endIndex = Number(seg.endIndex) + offset;
    }
  };

  for (const p of page.paragraphs ?? []) walkAnchor(p.layout?.textAnchor);
  for (const b of page.blocks ?? []) walkAnchor(b.layout?.textAnchor);
  for (const l of page.lines ?? []) walkAnchor(l.layout?.textAnchor);
  for (const t of page.tokens ?? []) walkAnchor(t.layout?.textAnchor);

  for (const f of page.formFields ?? []) {
    walkAnchor(f.fieldName?.textAnchor);
    walkAnchor(f.fieldValue?.textAnchor);
  }

  for (const table of page.tables ?? []) {
    for (const row of [...(table.headerRows ?? []), ...(table.bodyRows ?? [])]) {
      for (const cell of row.cells ?? []) {
        walkAnchor(cell.layout?.textAnchor);
      }
    }
  }

  walkAnchor(page.layout?.textAnchor);
}
