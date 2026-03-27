import { google } from "@google-cloud/documentai/build/protos/protos.js";

type IDocument = google.cloud.documentai.v1.IDocument;
type IPage = google.cloud.documentai.v1.Document.IPage;
type IParagraph = google.cloud.documentai.v1.Document.Page.IParagraph;

/**
 * Extracts text referenced by a text anchor from the full document text.
 * Pure function.
 */
export function extractTextFromAnchor(
  fullText: string,
  textAnchor: google.cloud.documentai.v1.Document.ITextAnchor | null | undefined,
): string {
  if (!textAnchor?.textSegments?.length) return "";

  return textAnchor.textSegments
    .map((segment) => {
      const start = Number(segment.startIndex ?? 0);
      const end = Number(segment.endIndex ?? 0);
      return fullText.slice(start, end);
    })
    .join("");
}

/**
 * Formats a single page's paragraphs as markdown text.
 * Pure function.
 */
function formatPageParagraphs(fullText: string, paragraphs: IParagraph[]): string {
  return paragraphs
    .map((p) => extractTextFromAnchor(fullText, p.layout?.textAnchor).trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Formats a Document AI OCR response into clean Markdown.
 * Pure function — no side effects.
 */
export function formatOcrToMarkdown(document: IDocument): string {
  const fullText = document.text ?? "";
  if (!fullText.trim()) return "_No text extracted from document._";

  const pages = document.pages ?? [];
  if (pages.length === 0) return fullText.trim();

  // Single page — no page headers needed
  if (pages.length === 1) {
    return formatSinglePage(fullText, pages[0]);
  }

  // Multi page — add page separators
  return pages
    .map((page, i) => {
      const pageText = formatSinglePage(fullText, page);
      return `## Page ${i + 1}\n\n${pageText}`;
    })
    .join("\n\n---\n\n");
}

function formatSinglePage(fullText: string, page: IPage): string {
  const paragraphs = page.paragraphs ?? [];
  if (paragraphs.length === 0) {
    // Fallback: use page-level text anchor
    return extractTextFromAnchor(fullText, page.layout?.textAnchor).trim();
  }
  return formatPageParagraphs(fullText, paragraphs);
}
