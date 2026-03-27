import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { apiKeyAuth, adminAuth } from "./auth/index.js";
import { initStorage } from "./storage/index.js";
import { registerRoutes } from "./register.js";
import { handleWorker } from "./worker.js";
import { handleCleanup } from "./cleanup.js";
import { adminRouter } from "./admin.js";
import { logger } from "./logger.js";

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const GCP_PROJECT = process.env.GCP_PROJECT;

if (!GCP_PROJECT) {
  logger.error("Missing required env var: GCP_PROJECT");
  process.exit(1);
}

initStorage(GCP_PROJECT);

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

// Registration (admin auth — called by CF frontend)
registerRoutes(app);

// Admin API (admin auth — called by CF frontend)
app.use("/admin", adminAuth, adminRouter);

// Worker (called by Cloud Tasks)
app.post("/worker", handleWorker);

// Cleanup (called by Cloud Scheduler)
app.post("/cleanup", adminAuth, handleCleanup);

// MCP endpoints (auth required)
const sessions = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", apiKeyAuth, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
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

app.get("/mcp", apiKeyAuth, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  await sessions.get(sessionId)!.handleRequest(req, res);
});

app.delete("/mcp", apiKeyAuth, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  await sessions.get(sessionId)!.handleRequest(req, res);
});

// Graceful shutdown
const server = app.listen(PORT, () => {
  logger.info("Server started", { port: PORT });
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
