import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enqueueProcessing } from "../queue/index.js";
import type { UserContext } from "../types.js";
import { documentInputSchema } from "./schema.js";

export function registerParseLayout(server: McpServer, userContext?: UserContext): void {
  server.tool(
    "parse_layout",
    "Analyze document structure (headings, paragraphs, lists, tables) using Document AI Layout Parser. Returns a task ID — use get_result to retrieve structured Markdown.",
    documentInputSchema,
    async ({ content, mimeType, gcsUri, url }) => {
      if (!userContext) {
        return { content: [{ type: "text" as const, text: "Error: not authenticated" }], isError: true };
      }

      try {
        const taskId = await enqueueProcessing({
          userId: userContext.userId,
          toolName: "parse_layout",
          input: { content, mimeType, gcsUri, url },
          credits: userContext.credits,
        });

        return {
          content: [{
            type: "text" as const,
            text: `Task queued. ID: ${taskId}\nCall get_result("${taskId}") in ~2000ms. The response will include an updated retry estimate if still processing.`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
