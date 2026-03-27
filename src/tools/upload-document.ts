import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { uploadDocument, uploadDocumentFromUrl } from "../gcs/index.js";
import type { UserContext } from "../types.js";

export function registerUploadDocument(server: McpServer, userContext?: UserContext): void {
  server.tool(
    "upload_document",
    "Upload a document to cloud storage and get a permanent GCS URI. Accepts base64 content or a URL. Use this to avoid temporary URL expiration issues before processing.",
    {
      content: z.string().optional().describe("Base64-encoded document content"),
      mimeType: z.string().optional().describe("MIME type (required with content, e.g. application/pdf)"),
      url: z.string().url().optional().describe("HTTP(S) URL to download the document from"),
      fileName: z.string().optional().describe("Optional file name (e.g. contrato.pdf)"),
    },
    async ({ content, mimeType, url, fileName }) => {
      if (!userContext) {
        return { content: [{ type: "text" as const, text: "Error: not authenticated" }], isError: true };
      }

      try {
        let gcsUri: string;

        if (url) {
          gcsUri = await uploadDocumentFromUrl(userContext.apiKeyHash, url, fileName);
        } else if (content && mimeType) {
          gcsUri = await uploadDocument(userContext.apiKeyHash, content, mimeType, fileName);
        } else {
          return {
            content: [{ type: "text" as const, text: "Error: provide either url or content+mimeType" }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: `Document uploaded successfully.\nGCS URI: ${gcsUri}\nUse this URI in ocr_document, parse_form, or parse_layout with the gcsUri parameter.`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
