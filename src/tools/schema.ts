import { z } from "zod";

export const documentInputSchema = {
  content: z
    .string()
    .optional()
    .describe("Base64-encoded document content"),
  mimeType: z
    .string()
    .optional()
    .describe("MIME type of the document (required with content). E.g. application/pdf, image/png"),
  gcsUri: z
    .string()
    .optional()
    .describe("Google Cloud Storage URI (gs://bucket/path/file.pdf)"),
  url: z
    .string()
    .url()
    .optional()
    .describe("HTTP(S) URL to download the document from"),
};
