import type { Request, Response, NextFunction } from "express";
import type Provider from "oidc-provider";
import { getUserById } from "../storage/index.js";
import type { UserContext } from "../types.js";

declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

/**
 * Express middleware: valida Bearer contra oidc-provider, resuelve UserContext.
 */
export function makeOauthTokenAuth(provider: Provider) {
  return async function oauthTokenAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const auth = req.headers["authorization"] as string | undefined;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401)
        .set("WWW-Authenticate", `Bearer resource_metadata="${process.env.SERVICE_URL}/.well-known/oauth-protected-resource"`)
        .json({ error: "missing_bearer" });
      return;
    }

    const token = auth.slice(7);
    const accessToken = await provider.AccessToken.find(token);

    if (!accessToken || accessToken.isExpired) {
      res.status(401).json({ error: "invalid_or_expired_token" });
      return;
    }

    const userId = accessToken.accountId;
    if (!userId) {
      res.status(401).json({ error: "token_missing_account" });
      return;
    }

    const user = await getUserById(userId);
    if (!user) {
      res.status(401).json({ error: "user_not_found" });
      return;
    }

    req.userContext = {
      userId: user.userId,
      email: user.email,
      credits: user.credits,
    };

    next();
  };
}
