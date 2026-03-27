import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enqueueProcessing } from "../queue/index.js";
import type { UserContext } from "../types.js";
import { documentInputSchema } from "./schema.js";

export function registerParseForm(server: McpServer, userContext?: UserContext): void {
  server.tool(
    "parse_form",
    "Extract form fields (key-value pairs) from a document using Document AI Form Parser. Returns a task ID — use get_result to retrieve the Markdown table.",
    documentInputSchema,
    async ({ content, mimeType, gcsUri, url }) => {
      if (!userContext) {
        return { content: [{ type: "text" as const, text: "Error: not authenticated" }], isError: true };
      }

      try {
        const taskId = await enqueueProcessing({
          userId: userContext.apiKeyHash,
          toolName: "parse_form",
          input: { content, mimeType, gcsUri, url },
          quota: userContext.quota,
        });

        return {
          content: [{
            type: "text" as const,
            text: `Task queued. ID: ${taskId}\nCall get_result("${taskId}") to check status and retrieve the result.`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
