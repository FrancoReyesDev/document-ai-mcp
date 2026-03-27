import { google } from "@google-cloud/documentai/build/protos/protos.js";
import { extractTextFromAnchor } from "./format-ocr.js";

type IDocument = google.cloud.documentai.v1.IDocument;
type IBlock = google.cloud.documentai.v1.Document.Page.IBlock;
type ITable = google.cloud.documentai.v1.Document.Page.ITable;
type ITableRow = google.cloud.documentai.v1.Document.Page.Table.ITableRow;

const HEADING_PATTERN = /^(title|heading|header)/i;

/**
 * Formats a table block as a markdown table.
 * Pure function.
 */
function formatTable(fullText: string, table: ITable): string {
  const formatRow = (row: ITableRow): string => {
    const cells = (row.cells ?? []).map((cell) =>
      extractTextFromAnchor(fullText, cell.layout?.textAnchor).trim().replace(/\n/g, " "),
    );
    return `| ${cells.join(" | ")} |`;
  };

  const rows: string[] = [];

  // Header rows
  const headerRows = table.headerRows ?? [];
  if (headerRows.length > 0) {
    rows.push(...headerRows.map(formatRow));
    const colCount = headerRows[0]?.cells?.length ?? 1;
    rows.push(`|${" --- |".repeat(colCount)}`);
  }

  // Body rows
  const bodyRows = table.bodyRows ?? [];
  if (bodyRows.length > 0) {
    // If no header, create separator after first body row
    if (headerRows.length === 0 && bodyRows.length > 0) {
      rows.push(formatRow(bodyRows[0]));
      const colCount = bodyRows[0]?.cells?.length ?? 1;
      rows.push(`|${" --- |".repeat(colCount)}`);
      rows.push(...bodyRows.slice(1).map(formatRow));
    } else {
      rows.push(...bodyRows.map(formatRow));
    }
  }

  return rows.join("\n");
}

/**
 * Determines markdown heading level from a block type string.
 * Pure function.
 */
function getHeadingPrefix(blockType: string): string {
  if (/title/i.test(blockType)) return "# ";
  if (/heading[-_]?1/i.test(blockType)) return "# ";
  if (/heading[-_]?2/i.test(blockType)) return "## ";
  if (/heading[-_]?3/i.test(blockType)) return "### ";
  if (HEADING_PATTERN.test(blockType)) return "## ";
  return "";
}

/**
 * Formats a Document AI Layout Parser response into structured Markdown.
 * Preserves headings, paragraphs, lists, and tables in reading order.
 * Pure function — no side effects.
 */
export function formatLayoutToMarkdown(document: IDocument): string {
  const fullText = document.text ?? "";
  const pages = document.pages ?? [];

  if (pages.length === 0) return "_No layout structure detected in document._";

  const pageOutputs = pages.map((page, i) => {
    const sections: string[] = [];

    // Process blocks in reading order
    const blocks = page.blocks ?? [];
    for (const block of blocks) {
      const text = extractTextFromAnchor(fullText, block.layout?.textAnchor).trim();
      if (!text) continue;

      const detectedType = block.layout?.orientation?.toString() ?? "";
      const prefix = getHeadingPrefix(detectedType);
      sections.push(`${prefix}${text}`);
    }

    // Process tables separately
    const tables = page.tables ?? [];
    for (const table of tables) {
      sections.push(formatTable(fullText, table));
    }

    // If no blocks/tables found, fallback to paragraphs
    if (sections.length === 0) {
      const paragraphs = page.paragraphs ?? [];
      for (const p of paragraphs) {
        const text = extractTextFromAnchor(fullText, p.layout?.textAnchor).trim();
        if (text) sections.push(text);
      }
    }

    const pageContent = sections.join("\n\n");
    return pages.length === 1 ? pageContent : `## Page ${i + 1}\n\n${pageContent}`;
  });

  return pageOutputs.join("\n\n---\n\n") || "_No layout structure detected in document._";
}
