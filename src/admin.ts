import { Router } from "express";
import { generateApiKey, hashApiKey } from "./auth/index.js";
import {
  createUser,
  getUserByEmail,
  deleteUser,
  addPagesByEmail,
  rotateUserKey,
  getUserTasks,
} from "./storage/index.js";
import { FREE_PAGES } from "./types.js";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "").split(",").filter(Boolean);

export const adminRouter: ReturnType<typeof Router> = Router();

// Create user
adminRouter.post("/users", async (req, res) => {
  const { email, initialPages } = req.body as { email?: string; initialPages?: number };

  if (!email) {
    res.status(400).json({ error: "Missing email" });
    return;
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "User already exists" });
    return;
  }

  const pages = initialPages ?? (ADMIN_EMAILS.includes(email) ? 10_000 : FREE_PAGES);
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  await createUser(apiKeyHash, email, pages);

  res.status(201).json({ apiKey, email, pagesAvailable: pages });
});

// Get user info
adminRouter.get("/users/:email", async (req, res) => {
  const user = await getUserByEmail(req.params.email);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    email: user.email,
    credits: user.credits,
    createdAt: user.createdAt,
    lastUsedAt: user.lastUsedAt,
  });
});

// Get user usage (credits + recent tasks)
adminRouter.get("/users/:email/usage", async (req, res) => {
  const user = await getUserByEmail(req.params.email);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const tasks = await getUserTasks(user.apiKeyHash);

  res.json({
    credits: user.credits,
    recentTasks: tasks.map((t) => ({
      taskId: t.taskId,
      toolName: t.toolName,
      status: t.status,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    })),
  });
});

// Rotate API key
adminRouter.post("/users/:email/rotate-key", async (req, res) => {
  const newApiKey = generateApiKey();
  const newHash = hashApiKey(newApiKey);
  const rotated = await rotateUserKey(req.params.email, newHash);

  if (!rotated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ apiKey: newApiKey });
});

// Add pages (called by web app after payment)
adminRouter.post("/users/:email/add-pages", async (req, res) => {
  const { pages } = req.body as { pages?: number };
  if (!pages || pages <= 0) {
    res.status(400).json({ error: "Invalid pages amount. Must be a positive number." });
    return;
  }

  const newBalance = await addPagesByEmail(req.params.email, pages);
  if (newBalance === null) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ pagesAdded: pages, pagesAvailable: newBalance });
});

// Delete user
adminRouter.delete("/users/:email", async (req, res) => {
  const deleted = await deleteUser(req.params.email);
  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ deleted: true });
});
