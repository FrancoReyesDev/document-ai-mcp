import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTask } from "../storage/index.js";
import { downloadMetadata, downloadPages } from "../gcs/index.js";
import type { ProcessingTask } from "../types.js";

/**
 * Heurística de latencia esperada:
 * - Online (≤15 páginas): ~2s base + ~500ms/page
 * - Batch (>15 páginas): ~3s base + ~1.5s/page (LRO de Document AI)
 * - Queued (sin startedAt aún): asumimos 1-2s de arranque.
 *
 * Devuelve ms a esperar antes del próximo poll (clamp 500ms mínimo).
 */
function estimateRetryMs(task: ProcessingTask): number {
  const pages = task.pageCount ?? 1;
  const isBatch = pages > 15;
  const expectedTotal = isBatch ? 3000 + pages * 1500 : 2000 + pages * 500;

  if (!task.startedAt) {
    // Aún en queue — esperar un poco para que el worker levante.
    return Math.min(2000, expectedTotal);
  }

  const elapsed = Date.now() - task.startedAt.getTime();
  const remaining = expectedTotal - elapsed;
  return Math.max(500, remaining);
}

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
          const retryMs = estimateRetryMs(task);
          const detail = task.pageCount
            ? `${task.pageCount} page${task.pageCount === 1 ? "" : "s"}, ${task.pageCount > 15 ? "batch" : "online"} mode`
            : "page count pending";
          return text(
            `Task ${taskId} is ${task.status} (${detail}). Call get_result again in ~${retryMs}ms.`,
          );
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
