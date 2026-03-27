import { Firestore } from "@google-cloud/firestore";
import type { UserRecord, ProcessingTask, QuotaInfo, PlanType } from "../types.js";
import { PLAN_QUOTAS } from "../types.js";

const USERS = "users";
const TASKS = "tasks";

let db: Firestore | null = null;

export function initStorage(gcpProject: string): void {
  db = new Firestore({ projectId: gcpProject });
}

function getDb(): Firestore {
  if (!db) throw new Error("Storage not initialized. Call initStorage() first.");
  return db;
}

// --- User CRUD ---

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "2026-03"
}

export async function getUserByApiKeyHash(apiKeyHash: string): Promise<UserRecord | null> {
  const doc = await getDb().collection(USERS).doc(apiKeyHash).get();
  if (!doc.exists) return null;

  const data = doc.data()!;
  return {
    apiKeyHash: data.apiKeyHash,
    email: data.email,
    plan: data.plan ?? "free",
    quota: data.quota ?? { monthlyPages: PLAN_QUOTAS.free, currentMonth: currentMonth(), pagesUsed: 0 },
    createdAt: data.createdAt?.toDate() ?? new Date(),
    lastUsedAt: data.lastUsedAt?.toDate() ?? new Date(),
  };
}

export async function createUser(apiKeyHash: string, email: string, plan: PlanType = "free"): Promise<void> {
  await getDb().collection(USERS).doc(apiKeyHash).set({
    apiKeyHash,
    email,
    plan,
    quota: { monthlyPages: PLAN_QUOTAS[plan], currentMonth: currentMonth(), pagesUsed: 0 },
    createdAt: new Date(),
    lastUsedAt: new Date(),
  });
}

export async function checkAndResetQuota(apiKeyHash: string): Promise<QuotaInfo> {
  const ref = getDb().collection(USERS).doc(apiKeyHash);
  const doc = await ref.get();
  const data = doc.data()!;
  const quota: QuotaInfo = data.quota;

  // Auto-reset if new month
  if (quota.currentMonth !== currentMonth()) {
    const resetQuota: QuotaInfo = { ...quota, currentMonth: currentMonth(), pagesUsed: 0 };
    await ref.update({ quota: resetQuota });
    return resetQuota;
  }

  return quota;
}

export async function incrementPagesUsed(apiKeyHash: string, pages: number): Promise<void> {
  const ref = getDb().collection(USERS).doc(apiKeyHash);
  const doc = await ref.get();
  const quota: QuotaInfo = doc.data()!.quota;
  await ref.update({ quota: { ...quota, pagesUsed: quota.pagesUsed + pages } });
}

// --- Task CRUD ---

export async function createTask(task: Omit<ProcessingTask, "completedAt" | "resultGcsUri" | "error">): Promise<void> {
  await getDb().collection(TASKS).doc(task.taskId).set(task);
}

export async function getTask(taskId: string): Promise<ProcessingTask | null> {
  const doc = await getDb().collection(TASKS).doc(taskId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    ...data,
    createdAt: data.createdAt?.toDate?.() ?? new Date(data.createdAt),
    completedAt: data.completedAt?.toDate?.() ?? (data.completedAt ? new Date(data.completedAt) : undefined),
  } as ProcessingTask;
}

export async function updateTask(taskId: string, updates: Partial<ProcessingTask>): Promise<void> {
  await getDb().collection(TASKS).doc(taskId).update(updates);
}

// --- Admin operations ---

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const snapshot = await getDb().collection(USERS).where("email", "==", email).limit(1).get();
  if (snapshot.empty) return null;
  const data = snapshot.docs[0].data();
  return {
    apiKeyHash: data.apiKeyHash,
    email: data.email,
    plan: data.plan ?? "free",
    quota: data.quota ?? { monthlyPages: PLAN_QUOTAS.free, currentMonth: currentMonth(), pagesUsed: 0 },
    createdAt: data.createdAt?.toDate() ?? new Date(),
    lastUsedAt: data.lastUsedAt?.toDate() ?? new Date(),
  };
}

export async function deleteUser(email: string): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user) return false;
  await getDb().collection(USERS).doc(user.apiKeyHash).delete();
  return true;
}

export async function updateUserPlan(email: string, plan: PlanType): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user) return false;
  const ref = getDb().collection(USERS).doc(user.apiKeyHash);
  await ref.update({ plan, "quota.monthlyPages": PLAN_QUOTAS[plan] });
  return true;
}

export async function rotateUserKey(
  email: string,
  newApiKeyHash: string,
): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user) return false;

  const db = getDb();
  const oldRef = db.collection(USERS).doc(user.apiKeyHash);
  const oldData = (await oldRef.get()).data()!;

  // Create new doc with new hash, delete old
  await db.collection(USERS).doc(newApiKeyHash).set({
    ...oldData,
    apiKeyHash: newApiKeyHash,
  });
  await oldRef.delete();
  return true;
}

export async function getUserTasks(apiKeyHash: string, limit = 20): Promise<ProcessingTask[]> {
  const snapshot = await getDb()
    .collection(TASKS)
    .where("userId", "==", apiKeyHash)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? new Date(data.createdAt),
      completedAt: data.completedAt?.toDate?.() ?? undefined,
    } as ProcessingTask;
  });
}
