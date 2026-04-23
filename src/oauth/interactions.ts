import { Router, type Request, type Response } from "express";
import type Provider from "oidc-provider";
import crypto from "node:crypto";
import { exchangeCodeForAccessToken, fetchGitHubProfile, githubAuthorizeUrl } from "./github.js";
import { createUserFromGithub, getUserByGithubId, updateLastLogin } from "../storage/index.js";
import { logger } from "../logger.js";

export interface InteractionsDeps {
  provider: Provider;
  githubClientId: string;
  githubClientSecret: string;
  issuer: string;
}

/**
 * GitHub requiere callback URL estático. Usamos `/oauth/interaction/callback/github`
 * y codificamos el `uid` de la interaction en el `state` param.
 */
const CALLBACK_PATH = "/callback/github";

export function interactionsRouter(deps: InteractionsDeps): ReturnType<typeof Router> {
  const router = Router();
  const { provider, githubClientId, githubClientSecret, issuer } = deps;
  const staticRedirectUri = `${issuer}/oauth/interaction${CALLBACK_PATH}`;

  router.get("/:uid", async (req: Request, res: Response) => {
    const { uid } = req.params;

    try {
      const details = await provider.interactionDetails(req, res);
      const { prompt, params, session } = details;

      // --- LOGIN prompt ---
      if (prompt.name === "login") {
        // Si volvemos del GitHub callback con el user resuelto → finalize.
        const resolvedUserId = req.cookies?.[`gh_resolved_${uid}`];
        if (resolvedUserId) {
          res.clearCookie(`gh_resolved_${uid}`);
          await provider.interactionFinished(
            req,
            res,
            { login: { accountId: resolvedUserId } },
            { mergeWithLastSubmission: false },
          );
          return;
        }

        // Primera vez → redirigimos a GitHub.
        const nonce = crypto.randomBytes(8).toString("hex");
        const state = `${uid}.${nonce}`;
        res.cookie(`gh_oauth_${uid}`, nonce, {
          httpOnly: true, secure: true, sameSite: "lax", maxAge: 10 * 60 * 1000, signed: false,
        });
        res.redirect(githubAuthorizeUrl(githubClientId, staticRedirectUri, state));
        return;
      }

      // --- CONSENT prompt: auto-grant ---
      // Para MCP, el user autoriza su propio tool. Otorgamos todos los scopes solicitados.
      if (prompt.name === "consent") {
        const accountId = session?.accountId;
        if (!accountId) throw new Error("consent without session");

        const { details: promptDetails } = prompt as unknown as {
          details: {
            missingOIDCScope?: string[];
            missingOIDCClaims?: string[];
            missingResourceScopes?: Record<string, string[]>;
          };
        };

        type GrantLike = {
          addOIDCScope: (scope: string) => void;
          addOIDCClaims: (claims: string[]) => void;
          addResourceScope: (resource: string, scope: string) => void;
          save: () => Promise<string>;
        };
        let grant: GrantLike;
        const GrantCtor = (provider as unknown as { Grant: new (args: { accountId: string; clientId?: string }) => GrantLike }).Grant;
        const grantId = (details as unknown as { grantId?: string }).grantId;
        if (grantId) {
          grant = await (provider as unknown as { Grant: { find: (id: string) => Promise<GrantLike> } }).Grant.find(grantId);
        } else {
          grant = new GrantCtor({ accountId, clientId: params.client_id as string });
        }

        if (promptDetails.missingOIDCScope) grant.addOIDCScope(promptDetails.missingOIDCScope.join(" "));
        if (promptDetails.missingOIDCClaims) grant.addOIDCClaims(promptDetails.missingOIDCClaims);
        if (promptDetails.missingResourceScopes) {
          for (const [resource, scopes] of Object.entries(promptDetails.missingResourceScopes)) {
            grant.addResourceScope(resource, scopes.join(" "));
          }
        }

        const newGrantId = await grant.save();
        const consent: { grantId?: string } = {};
        if (!grantId) consent.grantId = newGrantId;

        await provider.interactionFinished(
          req,
          res,
          { consent },
          { mergeWithLastSubmission: true },
        );
        return;
      }

      // Prompt desconocido → error explícito para no loopear.
      logger.error("Unknown interaction prompt", { name: prompt.name, uid });
      res.status(400).json({ error: "unsupported_prompt", prompt: prompt.name });
    } catch (err) {
      logger.error("Interaction GET failed", { error: String(err), stack: (err as Error)?.stack });
      res.status(500).json({ error: "interaction_failed", detail: String(err) });
    }
  });

  /**
   * Callback estático de GitHub. Uid viene en el `state`.
   */
  router.get(CALLBACK_PATH, async (req: Request, res: Response) => {
    const { code, state } = req.query as { code?: string; state?: string };

    try {
      if (!code || !state) throw new Error("Missing code or state");
      const [uid, nonce] = state.split(".");
      if (!uid || !nonce) throw new Error("Malformed state");
      const cookieNonce = req.cookies?.[`gh_oauth_${uid}`];
      if (cookieNonce !== nonce) throw new Error("Nonce mismatch");

      const accessToken = await exchangeCodeForAccessToken(githubClientId, githubClientSecret, code, staticRedirectUri);
      const profile = await fetchGitHubProfile(accessToken);

      let user = await getUserByGithubId(profile.githubId);
      if (!user) {
        user = await createUserFromGithub(profile);
        logger.info("New user created from GitHub OAuth", { userId: user.userId, email: user.email });
      } else {
        await updateLastLogin(user.userId);
      }

      res.clearCookie(`gh_oauth_${uid}`);
      res.cookie(`gh_resolved_${uid}`, user.userId, {
        httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 1000, signed: false,
      });
      res.redirect(`/oauth/interaction/${uid}`);
    } catch (err) {
      logger.error("GitHub callback failed", { error: String(err) });
      res.status(400).json({ error: "github_callback_failed", detail: String(err) });
    }
  });

  return router;
}
