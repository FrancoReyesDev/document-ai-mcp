import { Storage } from "@google-cloud/storage";

export const BATCH_BUCKET = process.env.BATCH_BUCKET ?? "document-ai-mcp-batch-temp";

let storage: Storage | null = null;

/** Singleton Storage client using ADC (Cloud Run SA). */
export function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}
