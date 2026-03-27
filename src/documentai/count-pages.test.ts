import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countPdfPages } from "./count-pages.js";

async function createPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage();
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("countPdfPages", () => {
  it("counts pages of a 1-page PDF", async () => {
    const pdf = await createPdf(1);
    expect(await countPdfPages(pdf)).toBe(1);
  });

  it("counts pages of a 15-page PDF", async () => {
    const pdf = await createPdf(15);
    expect(await countPdfPages(pdf)).toBe(15);
  });

  it("counts pages of a 100-page PDF", async () => {
    const pdf = await createPdf(100);
    expect(await countPdfPages(pdf)).toBe(100);
  });

  it("returns 0 for non-PDF", async () => {
    expect(await countPdfPages(Buffer.from("not a pdf"))).toBe(0);
  });

  it("returns 0 for empty buffer", async () => {
    expect(await countPdfPages(Buffer.alloc(0))).toBe(0);
  });
});
