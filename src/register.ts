import type { Express } from "express";
import { generateApiKey, hashApiKey, adminAuth } from "./auth/index.js";
import { createUser } from "./storage/index.js";
import type { PlanType } from "./types.js";

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
      const plan: PlanType = ADMIN_EMAILS.includes(email) ? "pro" : "free";
      const apiKey = generateApiKey();
      const apiKeyHash = hashApiKey(apiKey);

      await createUser(apiKeyHash, email, plan);

      res.status(201).json({
        apiKey,
        plan,
        monthlyPages: plan === "pro" ? 10000 : 100,
        message: "Registration successful.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Registration failed: ${message}` });
    }
  });
}
