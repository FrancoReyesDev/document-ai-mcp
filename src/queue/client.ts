import { CloudTasksClient } from "@google-cloud/tasks";

const GCP_PROJECT = process.env.GCP_PROJECT ?? "document-ai-mcp";
const GCP_LOCATION = process.env.QUEUE_LOCATION ?? "us-central1";
const QUEUE_ID = process.env.QUEUE_ID ?? "document-processing";

export const QUEUE_NAME = `projects/${GCP_PROJECT}/locations/${GCP_LOCATION}/queues/${QUEUE_ID}`;

let client: CloudTasksClient | null = null;

export function getTasksClient(): CloudTasksClient {
  if (!client) {
    client = new CloudTasksClient();
  }
  return client;
}
