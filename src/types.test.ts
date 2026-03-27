import { describe, it, expect } from "vitest";
import { PLAN_QUOTAS, PLAN_MAX_PAGES_PER_DOC } from "./types.js";
import type { PlanType } from "./types.js";

describe("Plan limits", () => {
  const plans: PlanType[] = ["free", "basic", "pro"];

  it("every plan has a monthly quota", () => {
    for (const plan of plans) {
      expect(PLAN_QUOTAS[plan]).toBeGreaterThan(0);
    }
  });

  it("every plan has a max pages per document", () => {
    for (const plan of plans) {
      expect(PLAN_MAX_PAGES_PER_DOC[plan]).toBeGreaterThan(0);
    }
  });

  it("quotas increase with plan tier", () => {
    expect(PLAN_QUOTAS.free).toBeLessThan(PLAN_QUOTAS.basic);
    expect(PLAN_QUOTAS.basic).toBeLessThan(PLAN_QUOTAS.pro);
  });

  it("max pages per doc increase with plan tier", () => {
    expect(PLAN_MAX_PAGES_PER_DOC.free).toBeLessThan(PLAN_MAX_PAGES_PER_DOC.basic);
    expect(PLAN_MAX_PAGES_PER_DOC.basic).toBeLessThan(PLAN_MAX_PAGES_PER_DOC.pro);
  });

  it("free plan: 100 pages/month, 50 per doc", () => {
    expect(PLAN_QUOTAS.free).toBe(100);
    expect(PLAN_MAX_PAGES_PER_DOC.free).toBe(50);
  });

  it("pro max per doc = 2000 (Document AI limit)", () => {
    expect(PLAN_MAX_PAGES_PER_DOC.pro).toBe(2000);
  });

  it("quota validation: document exceeds plan limit", () => {
    const pageCount = 100;
    const maxForFree = PLAN_MAX_PAGES_PER_DOC.free; // 50
    expect(pageCount > maxForFree).toBe(true);
  });

  it("quota validation: not enough remaining pages", () => {
    const pageCount = 10;
    const pagesUsed = 95;
    const monthlyPages = PLAN_QUOTAS.free; // 100
    const remaining = monthlyPages - pagesUsed; // 5
    expect(pageCount > remaining).toBe(true);
  });

  it("quota validation: within limits passes", () => {
    const pageCount = 30;
    const pagesUsed = 50;
    const monthlyPages = PLAN_QUOTAS.free; // 100
    const remaining = monthlyPages - pagesUsed; // 50
    expect(pageCount <= PLAN_MAX_PAGES_PER_DOC.free).toBe(true);
    expect(pageCount <= remaining).toBe(true);
  });
});
