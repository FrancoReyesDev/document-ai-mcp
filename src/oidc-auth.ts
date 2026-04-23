import type { Request, Response, NextFunction } from "express";
import { OAuth2Client } from "google-auth-library";
import { logger } from "./logger.js";

const oidcClient = new OAuth2Client();

/**
 * Middleware: valida OIDC token de Google (Cloud Tasks / Cloud Scheduler).
 * Usa WORKER_SA_EMAIL como service account esperado y SERVICE_URL como audience.
 * Si WORKER_SA_EMAIL no está seteado, deja pasar (modo local/dev).
 */
export async function verifyOidcMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const saEmail = process.env.WORKER_SA_EMAIL;
  if (!saEmail) return next();

  const authHeader = req.headers["authorization"] as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: missing OIDC token" });
    return;
  }

  try {
    const token = authHeader.slice(7);
    await oidcClient.verifyIdToken({ idToken: token, audience: process.env.SERVICE_URL });
    next();
  } catch (err) {
    logger.warn("OIDC verification failed", { error: String(err) });
    res.status(401).json({ error: "Unauthorized: invalid OIDC token" });
  }
}
