import express, { type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { initStorage, getDb, getUserTasks } from "./storage/index.js";
import { handleWorker } from "./worker.js";
import { handleCleanup } from "./cleanup.js";
import { verifyOidcMiddleware } from "./oidc-auth.js";
import { createOidcProvider, interactionsRouter, makeOauthTokenAuth } from "./oauth/index.js";
import { logger } from "./logger.js";

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const GCP_PROJECT = process.env.GCP_PROJECT;
const SERVICE_URL = process.env.SERVICE_URL;
/** URL base del web (dashboard + OAuth callback). Single source of truth — cuando cambie el dominio, cambiar solo esta env var. */
const WEB_URL = process.env.WEB_URL;
const WEB_CLIENT_ID = process.env.WEB_CLIENT_ID ?? "document-ai-web";
const WEB_CLIENT_SECRET = process.env.WEB_CLIENT_SECRET;
const GITHUB_OAUTH_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID;
const GITHUB_OAUTH_CLIENT_SECRET = process.env.GITHUB_OAUTH_CLIENT_SECRET;
const OAUTH_COOKIE_KEYS_RAW = process.env.OAUTH_COOKIE_KEYS;
const OAUTH_JWKS_RAW = process.env.OAUTH_JWKS;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    logger.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

requireEnv("GCP_PROJECT", GCP_PROJECT);
requireEnv("SERVICE_URL", SERVICE_URL);
requireEnv("WEB_URL", WEB_URL);
requireEnv("WEB_CLIENT_SECRET", WEB_CLIENT_SECRET);
requireEnv("GITHUB_OAUTH_CLIENT_ID", GITHUB_OAUTH_CLIENT_ID);
requireEnv("GITHUB_OAUTH_CLIENT_SECRET", GITHUB_OAUTH_CLIENT_SECRET);
requireEnv("OAUTH_COOKIE_KEYS", OAUTH_COOKIE_KEYS_RAW);
requireEnv("OAUTH_JWKS", OAUTH_JWKS_RAW);

const WEB_REDIRECT_URI = `${WEB_URL}/auth/callback`;

const cookieKeys = JSON.parse(OAUTH_COOKIE_KEYS_RAW!) as string[];
const jwks = JSON.parse(OAUTH_JWKS_RAW!);

initStorage(GCP_PROJECT!);

// AS live under `/oauth/*` — el issuer debe reflejar esa mount path para que
// `{issuer}/.well-known/oauth-authorization-server` resuelva donde oidc-provider lo sirve.
const AS_ISSUER = `${SERVICE_URL}/oauth`;

const provider = createOidcProvider({
  db: getDb(),
  issuer: AS_ISSUER,
  webClientId: WEB_CLIENT_ID,
  webClientSecret: WEB_CLIENT_SECRET!,
  webRedirectUri: WEB_REDIRECT_URI,
  cookieKeys,
  jwks,
});

const oauthTokenAuth = makeOauthTokenAuth(provider);

// Log internal errors de oidc-provider para debugging
const oidcErrorEvents = ["server_error", "grant.error", "authorization.error", "registration.error", "introspection.error", "revocation.error", "discovery.error"];
for (const event of oidcErrorEvents) {
  (provider as unknown as { on: (e: string, h: (ctx: unknown, err: Error) => void) => void }).on(event, (_ctx, err) => {
    logger.error(`oidc ${event}`, {
      name: err?.name,
      message: err?.message,
      stack: err?.stack?.split("\n").slice(0, 5).join(" | "),
    });
  });
}

// Trust proxy para que oidc-provider vea el scheme/host correcto detrás de Cloud Run
app.set("trust proxy", true);

app.use(cors());
app.use(cookieParser());

// Health
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "2.0.0" });
});

// Algunos MCP clients buscan el AS metadata en el root. Proxy hacia donde oidc-provider lo sirve.
app.get("/.well-known/oauth-authorization-server", async (_req, res) => {
  const upstream = await fetch(`${AS_ISSUER}/.well-known/oauth-authorization-server`);
  res.setHeader("content-type", "application/json");
  res.status(upstream.status).send(await upstream.text());
});

// MCP OAuth protected resource metadata (descubrimiento para clients MCP)
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: SERVICE_URL,
    authorization_servers: [AS_ISSUER],
    bearer_methods_supported: ["header"],
  });
});

// Interaction flow (login via GitHub) — ANTES de montar el provider callback
app.use(
  "/oauth/interaction",
  interactionsRouter({
    provider,
    githubClientId: GITHUB_OAUTH_CLIENT_ID!,
    githubClientSecret: GITHUB_OAUTH_CLIENT_SECRET!,
    issuer: SERVICE_URL!,
  }),
);

// OAuth AS endpoints (authorize, token, jwks, userinfo, registration, revocation, etc.)
app.use("/oauth", provider.callback());

// Worker (Cloud Tasks, OIDC)
app.use(express.json({ limit: "50mb" })); // json body parser AFTER oidc-provider mount
app.post("/worker", verifyOidcMiddleware, handleWorker);

// Cleanup (Cloud Scheduler, OIDC)
app.post("/cleanup", verifyOidcMiddleware, handleCleanup);

// User-scoped endpoints para el web dashboard (Bearer)
app.get("/me", oauthTokenAuth, (req: Request, res: Response) => {
  if (!req.userContext) { res.status(401).json({ error: "unauthenticated" }); return; }
  res.json({
    userId: req.userContext.userId,
    email: req.userContext.email,
    credits: req.userContext.credits,
  });
});

app.get("/me/usage", oauthTokenAuth, async (req: Request, res: Response) => {
  if (!req.userContext) { res.status(401).json({ error: "unauthenticated" }); return; }
  const tasks = await getUserTasks(req.userContext.userId);
  res.json({
    credits: req.userContext.credits,
    recentTasks: tasks.map((t) => ({
      taskId: t.taskId,
      toolName: t.toolName,
      status: t.status,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    })),
  });
});

// MCP endpoints (Bearer via oidc-provider)
const sessions = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", oauthTokenAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Session ID provisto pero no conocida → el server probablemente se reinició.
  // 404 per MCP Streamable HTTP spec → cliente debe re-inicializar.
  if (sessionId) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found. Re-initialize the MCP connection." },
      id: null,
    });
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
      },
    });

    transport.onclose = () => {
      const sid = [...sessions.entries()].find(([, t]) => t === transport)?.[0];
      if (sid) sessions.delete(sid);
    };

    const server = createServer(req.userContext);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({ error: "Invalid request: missing session ID or not an initialize request" });
});

app.get("/mcp", oauthTokenAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  await sessions.get(sessionId)!.handleRequest(req, res);
});

app.delete("/mcp", oauthTokenAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  await sessions.get(sessionId)!.handleRequest(req, res);
});

// Graceful shutdown
const server = app.listen(PORT, () => {
  logger.info("Server started", { port: PORT, issuer: SERVICE_URL });
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  for (const [sid, transport] of sessions) {
    transport.close?.();
    sessions.delete(sid);
  }
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
