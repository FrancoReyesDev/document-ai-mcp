/**
 * Splits formatted markdown output into individual pages.
 * Handles the "## Page N" + "---" separator pattern from formatters.
 * Pure function.
 */
export function splitMarkdownPages(markdown: string): string[] {
  // Split by the page separator: "\n\n---\n\n## Page N\n\n"
  const parts = markdown.split(/\n\n---\n\n(?=## Page \d+)/);

  if (parts.length === 0) return [markdown];

  return parts.map((part) => part.trim()).filter(Boolean);
}
