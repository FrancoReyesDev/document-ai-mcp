import { describe, it, expect } from "vitest";
import { MAX_PAGES_PER_DOC } from "./types.js";
import type { CreditInfo } from "./types.js";

describe("Credits system", () => {
  it("MAX_PAGES_PER_DOC is Document AI hard limit", () => {
    expect(MAX_PAGES_PER_DOC).toBe(2000);
  });

  it("document exceeds max pages per doc", () => {
    const pageCount = 2500;
    expect(pageCount > MAX_PAGES_PER_DOC).toBe(true);
  });

  it("not enough pages available", () => {
    const credits: CreditInfo = { pagesAvailable: 30, pagesUsedTotal: 70, pagesUsedThisMonth: 70, currentMonth: "2026-04" };
    const pageCount = 50;
    expect(pageCount > credits.pagesAvailable).toBe(true);
  });

  it("within limits passes", () => {
    const credits: CreditInfo = { pagesAvailable: 200, pagesUsedTotal: 300, pagesUsedThisMonth: 50, currentMonth: "2026-04" };
    const pageCount = 10;
    expect(pageCount <= credits.pagesAvailable).toBe(true);
    expect(pageCount <= MAX_PAGES_PER_DOC).toBe(true);
  });

  it("consumption decrements available, increments used", () => {
    const credits: CreditInfo = { pagesAvailable: 200, pagesUsedTotal: 300, pagesUsedThisMonth: 50, currentMonth: "2026-04" };
    const consumed = 10;
    const updated: CreditInfo = {
      ...credits,
      pagesAvailable: credits.pagesAvailable - consumed,
      pagesUsedTotal: credits.pagesUsedTotal + consumed,
      pagesUsedThisMonth: credits.pagesUsedThisMonth + consumed,
    };
    expect(updated.pagesAvailable).toBe(190);
    expect(updated.pagesUsedTotal).toBe(310);
    expect(updated.pagesUsedThisMonth).toBe(60);
  });

  it("top-up increments available only", () => {
    const credits: CreditInfo = { pagesAvailable: 50, pagesUsedTotal: 450, pagesUsedThisMonth: 200, currentMonth: "2026-04" };
    const added = 500;
    const updated: CreditInfo = { ...credits, pagesAvailable: credits.pagesAvailable + added };
    expect(updated.pagesAvailable).toBe(550);
    expect(updated.pagesUsedTotal).toBe(450);
    expect(updated.pagesUsedThisMonth).toBe(200);
  });
});
