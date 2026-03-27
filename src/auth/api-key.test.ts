import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey } from "./api-key.js";

describe("generateApiKey", () => {
  it("returns a base64url string of ~43 chars", () => {
    const key = generateApiKey();
    expect(key.length).toBeGreaterThanOrEqual(40);
    expect(key.length).toBeLessThanOrEqual(45);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });
});

describe("hashApiKey", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = hashApiKey("test-key");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("same input → same hash", () => {
    expect(hashApiKey("abc")).toBe(hashApiKey("abc"));
  });

  it("different input → different hash", () => {
    expect(hashApiKey("abc")).not.toBe(hashApiKey("xyz"));
  });
});
