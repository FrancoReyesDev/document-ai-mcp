import type { Request, Response } from "express";
import { Firestore } from "@google-cloud/firestore";
import { logger } from "./logger.js";

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Marks stale "processing" tasks as "failed".
 * Called by Cloud Scheduler every 15 minutes.
 */
export async function handleCleanup(_req: Request, res: Response): Promise<void> {
  try {
    const db = new Firestore({ projectId: process.env.GCP_PROJECT });
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const stale = await db
      .collection("tasks")
      .where("status", "==", "processing")
      .where("createdAt", "<", cutoff)
      .get();

    let cleaned = 0;
    for (const doc of stale.docs) {
      await doc.ref.update({
        status: "failed",
        error: "Timed out: task was processing for too long",
        completedAt: new Date(),
      });
      cleaned++;
    }

    logger.info("Cleanup completed", { cleaned, total: stale.size });
    res.json({ cleaned });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Cleanup failed", { error: message });
    res.status(500).json({ error: message });
  }
}
