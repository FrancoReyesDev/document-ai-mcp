import type { Request, Response, NextFunction } from "express";
import { hashApiKey } from "./api-key.js";
import { getUserByApiKeyHash } from "../storage/index.js";
import type { UserContext } from "../types.js";

declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

function extractApiKey(req: Request): string | undefined {
  const xApiKey = req.headers["x-api-key"] as string | undefined;
  if (xApiKey) return xApiKey;

  const auth = req.headers["authorization"] as string | undefined;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);

  return undefined;
}

/**
 * Express middleware: validates API key, resolves user, attaches UserContext.
 */
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    res.status(401).json({ error: "Missing API key. Use X-API-Key or Authorization: Bearer" });
    return;
  }

  const apiKeyHash = hashApiKey(apiKey);
  const user = await getUserByApiKeyHash(apiKeyHash);

  if (!user) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  req.userContext = {
    apiKeyHash: user.apiKeyHash,
    email: user.email,
    credits: user.credits,
  };

  next();
}
