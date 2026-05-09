import { describe, it, expect } from "vitest";
import { parsePageTags, detectRedactions } from "../src/ocr.js";

describe("parsePageTags", () => {
  it("parses two consecutive page tags into entries", () => {
    const input = '<page n="1">A</page><page n="2">B</page>';
    const out = parsePageTags(input);
    expect(out).toHaveLength(2);
    expect(out[0]?.pageNumber).toBe(1);
    expect(out[0]?.text).toBe("A");
    expect(out[0]?.hasRedactions).toBe(false);
    expect(out[1]?.pageNumber).toBe(2);
    expect(out[1]?.text).toBe("B");
    expect(out[1]?.hasRedactions).toBe(false);
  });

  it("handles whitespace and multi-line text inside tags", () => {
    const input = `<page n="1">
  line one
  line two
</page>
<page n="2">
\tindented body
</page>`;
    const out = parsePageTags(input);
    expect(out).toHaveLength(2);
    // Trimmed body, but newlines inside should remain.
    expect(out[0]?.text).toContain("line one");
    expect(out[0]?.text).toContain("line two");
    expect(out[0]?.text.startsWith(" ")).toBe(false);
    expect(out[0]?.text.endsWith("\n")).toBe(false);
    expect(out[1]?.text).toContain("indented body");
  });

  it("returns empty array on empty input", () => {
    expect(parsePageTags("")).toEqual([]);
  });

  it("returns empty array on input with no page tags", () => {
    expect(parsePageTags("just plain text without tags")).toEqual([]);
  });

  it("preserves out-of-order page numbers as given", () => {
    const input = '<page n="3">three</page><page n="1">one</page><page n="2">two</page>';
    const out = parsePageTags(input);
    expect(out.map((p) => p.pageNumber)).toEqual([3, 1, 2]);
    expect(out.map((p) => p.text)).toEqual(["three", "one", "two"]);
  });

  it("flags hasRedactions when body contains redaction markers", () => {
    const input = '<page n="1">name: [REDACTED]</page>';
    const out = parsePageTags(input);
    expect(out[0]?.hasRedactions).toBe(true);
  });

  it("sets ocrModel to claude-haiku-4-5", () => {
    const input = '<page n="1">x</page>';
    const out = parsePageTags(input);
    expect(out[0]?.ocrModel).toBe("claude-haiku-4-5");
    expect(out[0]?.ocrConfidence).toBeNull();
  });
});

describe("detectRedactions", () => {
  it("matches [REDACTED]", () => {
    expect(detectRedactions("the witness [REDACTED] said")).toBe(true);
  });

  it("matches solid block characters (████)", () => {
    expect(detectRedactions("name was ████ at the time")).toBe(true);
  });

  it("matches box characters (■■■)", () => {
    expect(detectRedactions("location ■■■ confirmed")).toBe(true);
  });

  it("returns false on plain text with no markers", () => {
    expect(detectRedactions("ordinary declassified document body")).toBe(false);
  });

  it("returns false on lowercase 'redacted' word (must be bracketed/box form)", () => {
    expect(detectRedactions("the page was redacted before release")).toBe(false);
  });

  it("returns false on empty string", () => {
    expect(detectRedactions("")).toBe(false);
  });
});
