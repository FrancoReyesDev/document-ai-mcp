import crypto from "node:crypto";

/**
 * Generates a cryptographically secure API key.
 * Pure function (uses random bytes).
 */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Hashes an API key with SHA-256 for safe storage/lookup.
 * Pure function.
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}
