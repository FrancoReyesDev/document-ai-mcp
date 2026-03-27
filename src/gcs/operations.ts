import crypto from "node:crypto";
import { google } from "@google-cloud/documentai/build/protos/protos.js";
import { getStorage, BATCH_BUCKET } from "./client.js";

type IDocument = google.cloud.documentai.v1.IDocument;

/**
 * Uploads base64 content to GCS. Returns the gs:// URI and the prefix for cleanup.
 */
export async function uploadInput(
  userHash: string,
  content: string,
  mimeType: string,
): Promise<{ gcsUri: string; prefix: string }> {
  const uuid = crypto.randomUUID();
  const ext = mimeTypeToExt(mimeType);
  const prefix = `${userHash}/${uuid}`;
  const objectPath = `${prefix}/input.${ext}`;

  const bucket = getStorage().bucket(BATCH_BUCKET);
  const file = bucket.file(objectPath);
  const buffer = Buffer.from(content, "base64");

  await file.save(buffer, { contentType: mimeType });

  return {
    gcsUri: `gs://${BATCH_BUCKET}/${objectPath}`,
    prefix,
  };
}

/**
 * Downloads and parses all output Document JSON files from a batch output prefix.
 * Returns IDocument array sorted by filename.
 */
export async function downloadOutputDocuments(prefix: string): Promise<IDocument[]> {
  const bucket = getStorage().bucket(BATCH_BUCKET);
  const outputPrefix = `${prefix}/output/`;

  const [files] = await bucket.getFiles({ prefix: outputPrefix });
  const jsonFiles = files
    .filter((f) => f.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (jsonFiles.length === 0) {
    throw new Error("Batch processing produced no output files");
  }

  const documents: IDocument[] = [];
  for (const file of jsonFiles) {
    const [buffer] = await file.download();
    const doc = JSON.parse(buffer.toString("utf8")) as IDocument;
    documents.push(doc);
  }

  return documents;
}

/**
 * Deletes all objects under a prefix. Best-effort, does not throw.
 */
export async function deletePrefix(prefix: string): Promise<void> {
  const bucket = getStorage().bucket(BATCH_BUCKET);
  const [files] = await bucket.getFiles({ prefix });

  await Promise.all(files.map((f) => f.delete().catch(() => {})));
}

/**
 * Builds a gs:// URI for a batch output directory.
 */
export function getOutputGcsUri(prefix: string): string {
  return `gs://${BATCH_BUCKET}/${prefix}/output/`;
}

/**
 * Uploads paged markdown results + metadata to GCS.
 * Structure: results/{taskId}/metadata.json + page-1.md, page-2.md, ...
 */
export async function uploadPagedResult(
  taskId: string,
  pages: string[],
): Promise<{ resultPrefix: string; metadata: import("../types.js").ResultMetadata }> {
  const bucket = getStorage().bucket(BATCH_BUCKET);
  const prefix = `results/${taskId}`;

  const metadata: import("../types.js").ResultMetadata = {
    totalPages: pages.length,
    totalChars: pages.reduce((sum, p) => sum + p.length, 0),
    pages: pages.map((p, i) => ({ page: i + 1, chars: p.length })),
  };

  // Upload metadata
  await bucket.file(`${prefix}/metadata.json`).save(
    JSON.stringify(metadata),
    { contentType: "application/json" },
  );

  // Upload pages in parallel
  await Promise.all(
    pages.map((content, i) =>
      bucket.file(`${prefix}/page-${i + 1}.md`).save(content, { contentType: "text/markdown" }),
    ),
  );

  return { resultPrefix: `gs://${BATCH_BUCKET}/${prefix}`, metadata };
}

/**
 * Downloads metadata for a paged result.
 */
export async function downloadMetadata(resultPrefix: string): Promise<import("../types.js").ResultMetadata> {
  const path = resultPrefix.replace(`gs://${BATCH_BUCKET}/`, "");
  const [buffer] = await getStorage().bucket(BATCH_BUCKET).file(`${path}/metadata.json`).download();
  return JSON.parse(buffer.toString("utf8"));
}

/**
 * Downloads specific pages from a paged result.
 */
export async function downloadPages(resultPrefix: string, pageFrom: number, pageTo: number): Promise<string> {
  const path = resultPrefix.replace(`gs://${BATCH_BUCKET}/`, "");
  const bucket = getStorage().bucket(BATCH_BUCKET);
  const parts: string[] = [];

  for (let i = pageFrom; i <= pageTo; i++) {
    const [buffer] = await bucket.file(`${path}/page-${i}.md`).download();
    parts.push(buffer.toString("utf8"));
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Uploads a user document to GCS for permanent storage. Returns gs:// URI.
 */
export async function uploadDocument(
  userHash: string,
  content: string,
  mimeType: string,
  fileName?: string,
): Promise<string> {
  const uuid = crypto.randomUUID();
  const ext = mimeTypeToExt(mimeType);
  const name = fileName ?? `document.${ext}`;
  const objectPath = `uploads/${userHash}/${uuid}/${name}`;

  const bucket = getStorage().bucket(BATCH_BUCKET);
  await bucket.file(objectPath).save(Buffer.from(content, "base64"), { contentType: mimeType });

  return `gs://${BATCH_BUCKET}/${objectPath}`;
}

/**
 * Downloads a file from URL and streams it directly to GCS. Returns gs:// URI.
 * Uses streaming pipe to avoid loading the entire file in memory.
 */
export async function uploadDocumentFromUrl(
  userHash: string,
  url: string,
  fileName?: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "application/pdf";
  const uuid = crypto.randomUUID();
  const ext = mimeTypeToExt(mimeType);
  const name = fileName ?? `document.${ext}`;
  const objectPath = `uploads/${userHash}/${uuid}/${name}`;

  const bucket = getStorage().bucket(BATCH_BUCKET);
  const gcsFile = bucket.file(objectPath);
  const writeStream = gcsFile.createWriteStream({ contentType: mimeType });

  // Stream from fetch response to GCS
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writeStream.write(value);
    }
    writeStream.end();
    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
  } catch (err) {
    writeStream.destroy();
    throw err;
  }

  return `gs://${BATCH_BUCKET}/${objectPath}`;
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/tiff": "tiff",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/webp": "webp",
  };
  return map[mimeType] ?? "pdf";
}
