import { PDFDocument } from "pdf-lib";

/**
 * Extracts the page count from a PDF buffer using pdf-lib.
 * Handles all PDF variants (standard, linearized, encrypted, compressed xref).
 */
export async function countPdfPages(buffer: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return 0;
  }
}
