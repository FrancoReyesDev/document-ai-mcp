import type { Express } from "express";
import { generateApiKey, hashApiKey, adminAuth } from "./auth/index.js";
import { createUser } from "./storage/index.js";
import { FREE_PAGES } from "./types.js";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "").split(",").filter(Boolean);

export function registerRoutes(app: Express): void {
  // Protected with admin key — called by CF frontend
  app.post("/register", adminAuth, async (req, res) => {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Missing required field: email" });
      return;
    }

    try {
      const initialPages = ADMIN_EMAILS.includes(email) ? 10_000 : FREE_PAGES;
      const apiKey = generateApiKey();
      const apiKeyHash = hashApiKey(apiKey);

      await createUser(apiKeyHash, email, initialPages);

      res.status(201).json({
        apiKey,
        pagesAvailable: initialPages,
        message: "Registration successful.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Registration failed: ${message}` });
    }
  });
}
