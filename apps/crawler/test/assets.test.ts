import { describe, it, expect } from "vitest";
import { extractAssetLinks, classifyAssetUrl } from "../src/assets.js";

const allowed = ["an.gov.br", "gov.br"] as const;
const base = new URL("https://sian.an.gov.br/list");

describe("classifyAssetUrl", () => {
  it("accepts a PDF on an allowed host and marks it for download", () => {
    const a = classifyAssetUrl("https://sian.an.gov.br/x.pdf", "Doc", base, allowed);
    expect(a?.mediaType).toBe("pdf");
    expect(a?.download).toBe(true);
    expect(a?.status).toBe("released");
  });

  it("classifies images as downloadable", () => {
    const a = classifyAssetUrl("a.JPG", "img", base, allowed);
    expect(a?.mediaType).toBe("image");
    expect(a?.download).toBe(true);
  });

  it("classifies audio/video as link-only (no download)", () => {
    const v = classifyAssetUrl("clip.mp4", null, base, allowed);
    expect(v?.mediaType).toBe("video");
    expect(v?.download).toBe(false);
    expect(classifyAssetUrl("rec.mp3", null, base, allowed)?.download).toBe(false);
  });

  it("rejects off-host URLs (SSRF guard)", () => {
    expect(classifyAssetUrl("https://evil.example.com/x.pdf", "x", base, allowed)).toBeNull();
  });

  it("rejects non-asset extensions and bare paths", () => {
    expect(classifyAssetUrl("page.html", "x", base, allowed)).toBeNull();
    expect(classifyAssetUrl("/", "x", base, allowed)).toBeNull();
  });

  it("rejects non-http(s) protocols", () => {
    expect(classifyAssetUrl("file:///etc/passwd.pdf", "x", base, allowed)).toBeNull();
  });

  it("resolves relative URLs against the base", () => {
    expect(classifyAssetUrl("docs/y.pdf", "y", base, allowed)?.url).toBe(
      "https://sian.an.gov.br/docs/y.pdf",
    );
  });
});

describe("extractAssetLinks", () => {
  it("extracts href + visible anchor text as the title", () => {
    const html = '<a href="https://sian.an.gov.br/a.pdf">Relatorio 1977</a>';
    const out = extractAssetLinks(html, base.toString(), allowed);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("Relatorio 1977");
    expect(out[0]?.mediaType).toBe("pdf");
  });

  it("dedupes repeated URLs", () => {
    const html = '<a href="a.pdf">1</a><a href="a.pdf">2</a>';
    expect(extractAssetLinks(html, base.toString(), allowed)).toHaveLength(1);
  });

  it("ignores nav links, non-asset links, and off-host links", () => {
    const html = [
      '<a href="/about">about</a>',
      '<a href="https://evil.example.com/x.pdf">evil</a>',
      '<a href="ok.pdf">ok</a>',
    ].join("");
    const out = extractAssetLinks(html, base.toString(), allowed);
    expect(out.map((a) => a.url)).toEqual(["https://sian.an.gov.br/ok.pdf"]);
  });

  it("strips nested tags out of the title", () => {
    const html = '<a href="a.pdf"><span>Doc</span> <b>X</b></a>';
    expect(extractAssetLinks(html, base.toString(), allowed)[0]?.title).toBe("Doc X");
  });

  it("returns an empty array for empty HTML", () => {
    expect(extractAssetLinks("", base.toString(), allowed)).toEqual([]);
  });
});
