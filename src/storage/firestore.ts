import { Firestore } from "@google-cloud/firestore";
import type { UserRecord, ProcessingTask, CreditInfo } from "../types.js";
import { FREE_PAGES } from "../types.js";

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

// --- Helpers ---

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "2026-04"
}

function defaultCredits(initialPages: number): CreditInfo {
  return { pagesAvailable: initialPages, pagesUsedTotal: 0, pagesUsedThisMonth: 0, currentMonth: currentMonth() };
}

function parseUserDoc(data: FirebaseFirestore.DocumentData): UserRecord {
  return {
    apiKeyHash: data.apiKeyHash,
    email: data.email,
    credits: data.credits ?? defaultCredits(FREE_PAGES),
    createdAt: data.createdAt?.toDate() ?? new Date(),
    lastUsedAt: data.lastUsedAt?.toDate() ?? new Date(),
  };
}

// --- User CRUD ---

export async function getUserByApiKeyHash(apiKeyHash: string): Promise<UserRecord | null> {
  const doc = await getDb().collection(USERS).doc(apiKeyHash).get();
  if (!doc.exists) return null;
  return parseUserDoc(doc.data()!);
}

export async function createUser(apiKeyHash: string, email: string, initialPages: number = FREE_PAGES): Promise<void> {
  await getDb().collection(USERS).doc(apiKeyHash).set({
    apiKeyHash,
    email,
    credits: defaultCredits(initialPages),
    createdAt: new Date(),
    lastUsedAt: new Date(),
  });
}

// --- Credit operations ---

export async function getCredits(apiKeyHash: string): Promise<CreditInfo> {
  const ref = getDb().collection(USERS).doc(apiKeyHash);
  const doc = await ref.get();
  const user = parseUserDoc(doc.data()!);
  let credits = user.credits;

  // Reset monthly counter if new month (stats only, does NOT affect pagesAvailable)
  if (credits.currentMonth !== currentMonth()) {
    credits = { ...credits, currentMonth: currentMonth(), pagesUsedThisMonth: 0 };
    await ref.update({ credits });
  }

  return credits;
}

export async function consumePages(apiKeyHash: string, pages: number): Promise<void> {
  const ref = getDb().collection(USERS).doc(apiKeyHash);
  const doc = await ref.get();
  const user = parseUserDoc(doc.data()!);
  let credits = user.credits;

  // Reset monthly counter if new month
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

export async function addPages(apiKeyHash: string, pages: number): Promise<number> {
  const ref = getDb().collection(USERS).doc(apiKeyHash);
  const doc = await ref.get();
  const user = parseUserDoc(doc.data()!);
  const newAvailable = user.credits.pagesAvailable + pages;
  await ref.update({ "credits.pagesAvailable": newAvailable });
  return newAvailable;
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
  return parseUserDoc(snapshot.docs[0].data());
}

export async function deleteUser(email: string): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user) return false;
  await getDb().collection(USERS).doc(user.apiKeyHash).delete();
  return true;
}

export async function addPagesByEmail(email: string, pages: number): Promise<number | null> {
  const user = await getUserByEmail(email);
  if (!user) return null;
  return addPages(user.apiKeyHash, pages);
}

export async function rotateUserKey(email: string, newApiKeyHash: string): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user) return false;

  const db = getDb();
  const oldRef = db.collection(USERS).doc(user.apiKeyHash);
  const oldData = (await oldRef.get()).data()!;

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
