import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTask } from "../storage/index.js";
import { downloadMetadata, downloadPages } from "../gcs/index.js";

export function registerGetResult(server: McpServer): void {
  server.tool(
    "get_result",
    "Check the status of a document processing task and retrieve results. Without page params, returns metadata (total pages, chars). With pageFrom/pageTo, returns those pages.",
    {
      taskId: z.string().describe("The task ID returned by a processing tool"),
      pageFrom: z.number().int().min(1).optional().describe("First page to retrieve (1-indexed)"),
      pageTo: z.number().int().min(1).optional().describe("Last page to retrieve (1-indexed, inclusive)"),
    },
    async ({ taskId, pageFrom, pageTo }) => {
      try {
        const task = await getTask(taskId);

        if (!task) {
          return error(`Task ${taskId} not found`);
        }

        if (task.status === "queued" || task.status === "processing") {
          return text(`Task ${taskId} is ${task.status}. Please wait and call get_result again in a few seconds.`);
        }

        if (task.status === "failed") {
          return error(`Task ${taskId} failed: ${task.error}`);
        }

        if (!task.resultGcsUri) {
          return error("Task completed but no result found");
        }

        // If no page params, return metadata
        if (pageFrom == null && pageTo == null) {
          const metadata = await downloadMetadata(task.resultGcsUri);
          return text(
            `Task completed. ${metadata.totalPages} pages, ${metadata.totalChars} characters total.\n` +
            `Use get_result with pageFrom and pageTo to retrieve specific pages (1-${metadata.totalPages}).`,
          );
        }

        // Validate and download pages
        const metadata = await downloadMetadata(task.resultGcsUri);
        const from = pageFrom ?? 1;
        const to = Math.min(pageTo ?? from, metadata.totalPages);

        if (from > metadata.totalPages) {
          return error(`Page ${from} exceeds total pages (${metadata.totalPages})`);
        }

        const content = await downloadPages(task.resultGcsUri, from, to);
        return text(content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return error(message);
      }
    },
  );
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function error(t: string) {
  return { content: [{ type: "text" as const, text: `Error: ${t}` }], isError: true };
}
