import crypto from "node:crypto";
import { getTasksClient, QUEUE_NAME } from "./client.js";
import { createTask, getCredits } from "../storage/index.js";
import type { DocumentInput, CreditInfo } from "../types.js";

const SERVICE_URL = process.env.SERVICE_URL ?? "";
const SA_EMAIL = process.env.WORKER_SA_EMAIL ?? "";

export interface EnqueueParams {
  userId: string;
  toolName: "ocr_document" | "parse_form" | "parse_layout";
  input: DocumentInput;
  credits: CreditInfo;
}

/** Removes undefined values that Firestore rejects. */
function cleanInput(input: DocumentInput): DocumentInput {
  return JSON.parse(JSON.stringify(input));
}

/**
 * Checks credits, creates task in Firestore, enqueues in Cloud Tasks.
 * Throws if no pages available.
 */
export async function enqueueProcessing(params: EnqueueParams): Promise<string> {
  const credits = await getCredits(params.userId);
  if (credits.pagesAvailable <= 0) {
    const dashboardUrl = `${process.env.WEB_URL ?? ""}/dashboard`;
    throw new Error(
      `No pages available. You've used your beta allowance. Visit ${dashboardUrl} to request more access.`,
    );
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
      audience: SERVICE_URL,
    };
  }

  await getTasksClient().createTask({ parent: QUEUE_NAME, task });

  return taskId;
}
