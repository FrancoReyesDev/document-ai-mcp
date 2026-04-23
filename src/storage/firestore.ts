import { Firestore } from "@google-cloud/firestore";
import crypto from "node:crypto";
import type { UserRecord, ProcessingTask, CreditInfo } from "../types.js";
import type { GitHubProfile } from "../oauth/github.js";

const USERS = "users";
const TASKS = "tasks";

let db: Firestore | null = null;

export function initStorage(gcpProject: string): void {
  db = new Firestore({ projectId: gcpProject, ignoreUndefinedProperties: true });
}

export function getDb(): Firestore {
  if (!db) throw new Error("Storage not initialized. Call initStorage() first.");
  return db;
}

// --- Helpers ---

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "2026-04"
}

/** Grant inicial al primer OAuth. Suficiente para probar el servicio; más = contactar admin. */
const SIGNUP_FREE_PAGES = 100;

function signupCredits(): CreditInfo {
  return { pagesAvailable: SIGNUP_FREE_PAGES, pagesUsedTotal: 0, pagesUsedThisMonth: 0, currentMonth: currentMonth() };
}

function zeroCredits(): CreditInfo {
  return { pagesAvailable: 0, pagesUsedTotal: 0, pagesUsedThisMonth: 0, currentMonth: currentMonth() };
}

function parseUserDoc(data: FirebaseFirestore.DocumentData): UserRecord {
  return {
    userId: data.userId,
    githubId: data.githubId,
    email: data.email,
    name: data.name ?? null,
    avatarUrl: data.avatarUrl ?? null,
    credits: data.credits ?? zeroCredits(),
    createdAt: data.createdAt?.toDate?.() ?? new Date(),
    lastUsedAt: data.lastUsedAt?.toDate?.() ?? new Date(),
  };
}

// --- User CRUD ---

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const doc = await getDb().collection(USERS).doc(userId).get();
  if (!doc.exists) return null;
  return parseUserDoc(doc.data()!);
}

export async function getUserByGithubId(githubId: string): Promise<UserRecord | null> {
  const snapshot = await getDb().collection(USERS).where("githubId", "==", githubId).limit(1).get();
  if (snapshot.empty) return null;
  return parseUserDoc(snapshot.docs[0].data());
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const snapshot = await getDb().collection(USERS).where("email", "==", email).limit(1).get();
  if (snapshot.empty) return null;
  return parseUserDoc(snapshot.docs[0].data());
}

export async function createUserFromGithub(profile: GitHubProfile): Promise<UserRecord> {
  const userId = crypto.randomUUID();
  const now = new Date();
  const record = {
    userId,
    githubId: profile.githubId,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    credits: signupCredits(),
    createdAt: now,
    lastUsedAt: now,
  };
  await getDb().collection(USERS).doc(userId).set(record);
  return { ...record, createdAt: now, lastUsedAt: now };
}

export async function updateLastLogin(userId: string): Promise<void> {
  await getDb().collection(USERS).doc(userId).update({ lastUsedAt: new Date() });
}

// --- Credit operations ---

export async function getCredits(userId: string): Promise<CreditInfo> {
  const ref = getDb().collection(USERS).doc(userId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`User not found: ${userId}`);
  const user = parseUserDoc(doc.data()!);
  let credits = user.credits;

  // Reset monthly counter on new month (stats only, no afecta pagesAvailable)
  if (credits.currentMonth !== currentMonth()) {
    credits = { ...credits, currentMonth: currentMonth(), pagesUsedThisMonth: 0 };
    await ref.update({ credits });
  }

  return credits;
}

export async function consumePages(userId: string, pages: number): Promise<void> {
  const ref = getDb().collection(USERS).doc(userId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`User not found: ${userId}`);
  const user = parseUserDoc(doc.data()!);
  let credits = user.credits;

  if (credits.currentMonth !== currentMonth()) {
    credits = { ...credits, currentMonth: currentMonth(), pagesUsedThisMonth: 0 };
  }

  await ref.update({
    credits: {
      ...credits,
      pagesAvailable: credits.pagesAvailable - pages,
      pagesUsedTotal: credits.pagesUsedTotal + pages,
      pagesUsedThisMonth: credits.pagesUsedThisMonth + pages,
    },
    lastUsedAt: new Date(),
  });
}

export async function addPages(userId: string, pages: number): Promise<number> {
  const ref = getDb().collection(USERS).doc(userId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`User not found: ${userId}`);
  const user = parseUserDoc(doc.data()!);
  const newAvailable = user.credits.pagesAvailable + pages;
  await ref.update({ "credits.pagesAvailable": newAvailable });
  return newAvailable;
}

// --- Task CRUD ---

/** Retention de task docs: 90 días post-creación. Firestore TTL borra vía `expiresAt`. */
const TASK_TTL_DAYS = 90;

export async function createTask(task: Omit<ProcessingTask, "completedAt" | "resultGcsUri" | "error" | "expiresAt">): Promise<void> {
  const expiresAt = new Date(task.createdAt.getTime() + TASK_TTL_DAYS * 24 * 60 * 60 * 1000);
  await getDb().collection(TASKS).doc(task.taskId).set({ ...task, expiresAt });
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

export async function getUserTasks(userId: string, limit = 20): Promise<ProcessingTask[]> {
  const snapshot = await getDb()
    .collection(TASKS)
    .where("userId", "==", userId)
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
