import { google } from "@google-cloud/documentai/build/protos/protos.js";
import { extractTextFromAnchor } from "./format-ocr.js";

type IDocument = google.cloud.documentai.v1.IDocument;
type IFormField = google.cloud.documentai.v1.Document.Page.IFormField;

interface FormField {
  name: string;
  value: string;
  confidence: number;
}

/**
 * Extracts a form field's name and value from the document text.
 * Pure function.
 */
function parseFormField(fullText: string, field: IFormField): FormField {
  const name = extractTextFromAnchor(fullText, field.fieldName?.textAnchor).trim();
  const value = extractTextFromAnchor(fullText, field.fieldValue?.textAnchor).trim();
  const confidence = field.fieldValue?.confidence ?? 0;
  return { name, value, confidence };
}

/**
 * Formats form fields as a markdown table.
 * Pure function.
 */
function formatFieldsTable(fields: FormField[]): string {
  if (fields.length === 0) return "_No form fields detected._";

  const header = "| Field | Value | Confidence |";
  const separator = "|-------|-------|------------|";
  const rows = fields.map(
    (f) => `| ${f.name} | ${f.value} | ${(f.confidence * 100).toFixed(0)}% |`,
  );

  return [header, separator, ...rows].join("\n");
}

/**
 * Formats a Document AI Form Parser response into Markdown tables.
 * Pure function — no side effects.
 */
export function formatFormToMarkdown(document: IDocument): string {
  const fullText = document.text ?? "";
  const pages = document.pages ?? [];

  if (pages.length === 0) return "_No form fields detected in document._";

  const pageOutputs = pages
    .map((page, i) => {
      const fields = (page.formFields ?? []).map((f) => parseFormField(fullText, f));
      const table = formatFieldsTable(fields);

      return pages.length === 1 ? table : `## Page ${i + 1}\n\n${table}`;
    })
    .filter(Boolean);

  return pageOutputs.join("\n\n---\n\n");
}
