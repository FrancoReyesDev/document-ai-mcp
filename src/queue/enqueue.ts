import crypto from "node:crypto";
import { getTasksClient, QUEUE_NAME } from "./client.js";
import { createTask, checkAndResetQuota } from "../storage/index.js";
import type { DocumentInput, QuotaInfo } from "../types.js";

const SERVICE_URL = process.env.SERVICE_URL ?? "";
const SA_EMAIL = process.env.WORKER_SA_EMAIL ?? "";

export interface EnqueueParams {
  userId: string;
  toolName: "ocr_document" | "parse_form" | "parse_layout";
  input: DocumentInput;
  quota: QuotaInfo;
}

/** Removes undefined values that Firestore rejects. */
function cleanInput(input: DocumentInput): DocumentInput {
  return JSON.parse(JSON.stringify(input));
}

/**
 * Checks quota, creates task in Firestore, enqueues in Cloud Tasks.
 * Throws if quota exceeded.
 */
export async function enqueueProcessing(params: EnqueueParams): Promise<string> {
  // Check and auto-reset quota
  const quota = await checkAndResetQuota(params.userId);
  if (quota.pagesUsed >= quota.monthlyPages) {
    throw new Error(`Quota exceeded: ${quota.pagesUsed}/${quota.monthlyPages} pages used this month. Upgrade your plan.`);
  }

  const taskId = crypto.randomUUID();
  const input = cleanInput(params.input);

  await createTask({
    taskId,
    userId: params.userId,
    toolName: params.toolName,
    input,
    status: "queued",
    createdAt: new Date(),
  });

  const payload = JSON.stringify({
    taskId,
    userId: params.userId,
    toolName: params.toolName,
    input,
  });

  const task: Record<string, unknown> = {
    httpRequest: {
      httpMethod: "POST" as const,
      url: `${SERVICE_URL}/worker`,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(payload).toString("base64"),
    },
  };

  if (SA_EMAIL) {
    (task.httpRequest as Record<string, unknown>).oidcToken = {
      serviceAccountEmail: SA_EMAIL,
    };
  }

  await getTasksClient().createTask({ parent: QUEUE_NAME, task });

  return taskId;
}
