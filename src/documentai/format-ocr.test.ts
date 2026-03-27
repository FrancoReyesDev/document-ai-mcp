import { describe, it, expect } from "vitest";
import { formatOcrToMarkdown } from "./format-ocr.js";
import { google } from "@google-cloud/documentai/build/protos/protos.js";

type IDocument = google.cloud.documentai.v1.IDocument;

function makeDoc(pages: string[]): IDocument {
  let text = "";
  const docPages = pages.map((pageText) => {
    const start = text.length;
    text += pageText;
    const end = text.length;
    return {
      paragraphs: [{
        layout: {
          textAnchor: {
            textSegments: [{ startIndex: start, endIndex: end }],
          },
        },
      }],
    };
  });

  return { text, pages: docPages };
}

describe("formatOcrToMarkdown", () => {
  it("single page — no page header", () => {
    const doc = makeDoc(["Hello world"]);
    const md = formatOcrToMarkdown(doc);
    expect(md).toBe("Hello world");
    expect(md).not.toContain("## Page");
  });

  it("3 pages — headers + separators", () => {
    const doc = makeDoc(["Page one", "Page two", "Page three"]);
    const md = formatOcrToMarkdown(doc);
    expect(md).toContain("## Page 1");
    expect(md).toContain("## Page 2");
    expect(md).toContain("## Page 3");
    expect(md).toContain("---");
  });

  it("empty document — fallback message", () => {
    const doc: IDocument = { text: "", pages: [] };
    const md = formatOcrToMarkdown(doc);
    expect(md).toContain("No text extracted");
  });
});
