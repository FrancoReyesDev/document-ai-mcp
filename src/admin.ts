import { Router } from "express";
import { generateApiKey, hashApiKey } from "./auth/index.js";
import {
  createUser,
  getUserByEmail,
  deleteUser,
  updateUserPlan,
  rotateUserKey,
  getUserTasks,
} from "./storage/index.js";
import type { PlanType } from "./types.js";
import { PLAN_QUOTAS } from "./types.js";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "").split(",").filter(Boolean);

export const adminRouter: ReturnType<typeof Router> = Router();

// Create user
adminRouter.post("/users", async (req, res) => {
  const { email, plan } = req.body as { email?: string; plan?: PlanType };

  if (!email) {
    res.status(400).json({ error: "Missing email" });
    return;
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "User already exists" });
    return;
  }

  const effectivePlan: PlanType = plan ?? (ADMIN_EMAILS.includes(email) ? "pro" : "free");
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  await createUser(apiKeyHash, email, effectivePlan);

  res.status(201).json({
    apiKey,
    email,
    plan: effectivePlan,
    monthlyPages: PLAN_QUOTAS[effectivePlan],
  });
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
    plan: user.plan,
    quota: user.quota,
    createdAt: user.createdAt,
    lastUsedAt: user.lastUsedAt,
  });
});

// Get user usage (quota + recent tasks)
adminRouter.get("/users/:email/usage", async (req, res) => {
  const user = await getUserByEmail(req.params.email);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const tasks = await getUserTasks(user.apiKeyHash);

  res.json({
    quota: user.quota,
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

// Upgrade plan
adminRouter.post("/users/:email/upgrade", async (req, res) => {
  const { plan } = req.body as { plan?: PlanType };
  if (!plan || !PLAN_QUOTAS[plan]) {
    res.status(400).json({ error: "Invalid plan. Options: free, basic, pro" });
    return;
  }

  const updated = await updateUserPlan(req.params.email, plan);
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ plan, monthlyPages: PLAN_QUOTAS[plan] });
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
