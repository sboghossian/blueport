import { describe, it, expect } from "vitest";
import { extractPdfUrls } from "../src/crawl.js";

const allowed = ["war.gov"] as const;

describe("extractPdfUrls", () => {
  const baseUrl = "https://war.gov/uap/index.html";

  it("returns absolute URLs from relative href", () => {
    const html = '<a href="foo.pdf">Foo</a>';
    const urls = extractPdfUrls(html, baseUrl, allowed);
    expect(urls).toEqual(["https://war.gov/uap/foo.pdf"]);
  });

  it("resolves relative paths against the base URL", () => {
    const html = [
      '<a href="docs/a.pdf">A</a>',
      '<a href="../release/b.pdf">B</a>',
      '<a href="/absolute/c.pdf">C</a>',
    ].join("\n");
    const urls = new Set(extractPdfUrls(html, baseUrl, allowed));
    expect(urls).toEqual(
      new Set([
        "https://war.gov/uap/docs/a.pdf",
        "https://war.gov/release/b.pdf",
        "https://war.gov/absolute/c.pdf",
      ]),
    );
  });

  it("dedupes repeated URLs", () => {
    const html = '<a href="foo.pdf">1</a><a href="foo.pdf">2</a>';
    const urls = extractPdfUrls(html, baseUrl, allowed);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://war.gov/uap/foo.pdf");
  });

  it("preserves query strings on PDF URLs", () => {
    const html = '<a href="x.pdf?download=1">DL</a>';
    const urls = extractPdfUrls(html, baseUrl, allowed);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://war.gov/uap/x.pdf?download=1");
  });

  it("does not throw on malformed URLs", () => {
    const html = '<a href="http://[::bad::/oops.pdf">bad</a><a href="ok.pdf">ok</a>';
    expect(() => extractPdfUrls(html, baseUrl, allowed)).not.toThrow();
    const urls = extractPdfUrls(html, baseUrl, allowed);
    expect(urls).toContain("https://war.gov/uap/ok.pdf");
  });

  it("returns empty array for empty HTML", () => {
    expect(extractPdfUrls("", baseUrl, allowed)).toEqual([]);
  });

  it("returns empty array when no PDF links present", () => {
    const html = '<a href="page.html">page</a><a href="img.png">img</a>';
    expect(extractPdfUrls(html, baseUrl, allowed)).toEqual([]);
  });

  it("collects multiple distinct PDFs (set equality, order-agnostic)", () => {
    const html = [
      '<a href="one.pdf">1</a>',
      '<a href="two.pdf">2</a>',
      '<a href="three.pdf">3</a>',
    ].join(" ");
    const urls = new Set(extractPdfUrls(html, baseUrl, allowed));
    expect(urls).toEqual(
      new Set([
        "https://war.gov/uap/one.pdf",
        "https://war.gov/uap/two.pdf",
        "https://war.gov/uap/three.pdf",
      ]),
    );
  });

  it("rejects URLs whose hostname is not in the allowlist (SSRF guard)", () => {
    const html = [
      '<a href="http://169.254.169.254/latest/meta-data/iam/security-credentials/x.pdf">imds</a>',
      '<a href="http://10.0.0.1/internal.pdf">private</a>',
      '<a href="https://evil.example.com/pwn.pdf">evil</a>',
      '<a href="legit.pdf">legit</a>',
    ].join("\n");
    const urls = extractPdfUrls(html, baseUrl, allowed);
    expect(urls).toEqual(["https://war.gov/uap/legit.pdf"]);
  });

  it("accepts subdomains of allowed hosts", () => {
    const html = '<a href="https://docs.war.gov/release.pdf">d</a>';
    const urls = extractPdfUrls(html, baseUrl, allowed);
    expect(urls).toEqual(["https://docs.war.gov/release.pdf"]);
  });

  it("rejects non-http(s) protocols", () => {
    const html = '<a href="file:///etc/passwd.pdf">f</a><a href="ok.pdf">ok</a>';
    const urls = extractPdfUrls(html, baseUrl, allowed);
    expect(urls).toEqual(["https://war.gov/uap/ok.pdf"]);
  });
});
