import { describe, it, expect } from "vitest";
import { splitMarkdownPages } from "./split-pages.js";

describe("splitMarkdownPages", () => {
  it("single page — returns array of 1", () => {
    const md = "## Page 1\n\nSome text here.";
    expect(splitMarkdownPages(md)).toEqual(["## Page 1\n\nSome text here."]);
  });

  it("3 pages — splits correctly", () => {
    const md = [
      "## Page 1\n\nFirst page content.",
      "## Page 2\n\nSecond page content.",
      "## Page 3\n\nThird page content.",
    ].join("\n\n---\n\n");

    const pages = splitMarkdownPages(md);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("First page");
    expect(pages[1]).toContain("Second page");
    expect(pages[2]).toContain("Third page");
  });

  it("no page headers — returns as single page", () => {
    const md = "Just plain text without page headers.";
    expect(splitMarkdownPages(md)).toEqual(["Just plain text without page headers."]);
  });

  it("empty string — returns empty array", () => {
    expect(splitMarkdownPages("")).toEqual([]);
  });
});
