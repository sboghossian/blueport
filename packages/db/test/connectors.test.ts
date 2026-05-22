import { describe, it, expect } from "vitest";
import {
  CONNECTORS,
  getConnector,
  isHostAllowed,
  mediaTypeForExtension,
} from "../src/connectors.js";

describe("connector registry", () => {
  it("includes the core sources", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(ids).toContain("us-war-gov");
    expect(ids).toContain("us-aaro");
    expect(ids[0]).toBe("us-war-gov");
  });

  it("has unique connector ids", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every connector has start urls, allowed hosts, and a valid kind", () => {
    for (const c of CONNECTORS) {
      expect(c.startUrls.length).toBeGreaterThan(0);
      expect(c.allowedHosts.length).toBeGreaterThan(0);
      expect(["fetch", "browser", "wayback", "github-corpus"]).toContain(c.kind);
    }
  });

  it("every fetch/browser start url lives under the connector's allowed hosts", () => {
    for (const c of CONNECTORS) {
      // wayback startUrls are CDX url-match patterns, not real URLs.
      if (c.kind === "wayback") continue;
      for (const url of c.startUrls) {
        expect(isHostAllowed(new URL(url).hostname, c.allowedHosts)).toBe(true);
      }
    }
  });

  it("never seeds a referenced item without a source url (no fabrication)", () => {
    for (const c of CONNECTORS) {
      for (const seed of c.seedReferenced ?? []) {
        expect(seed.sourceUrl).toMatch(/^https?:\/\//);
        expect(seed.title.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getConnector", () => {
  it("resolves a known id with its country", () => {
    expect(getConnector("br-sian")?.country).toBe("BR");
    expect(getConnector("us-war-gov")?.kind).toBe("fetch");
    expect(getConnector("corbell-sleeping-dog")?.kind).toBe("browser");
  });

  it("returns undefined for an unknown id", () => {
    expect(getConnector("does-not-exist")).toBeUndefined();
  });
});

describe("isHostAllowed", () => {
  it("matches an exact host", () => {
    expect(isHostAllowed("war.gov", ["war.gov"])).toBe(true);
  });

  it("matches a subdomain on a dot boundary", () => {
    expect(isHostAllowed("docs.war.gov", ["war.gov"])).toBe(true);
    expect(isHostAllowed("sian.an.gov.br", ["an.gov.br"])).toBe(true);
  });

  it("rejects an unrelated host", () => {
    expect(isHostAllowed("evil.example.com", ["war.gov"])).toBe(false);
  });

  it("rejects a non-dot-boundary suffix match (SSRF guard)", () => {
    expect(isHostAllowed("notwar.gov", ["war.gov"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isHostAllowed("WAR.GOV", ["war.gov"])).toBe(true);
  });
});

describe("mediaTypeForExtension", () => {
  it("maps each media family", () => {
    expect(mediaTypeForExtension("pdf")).toBe("pdf");
    expect(mediaTypeForExtension("PNG")).toBe("image");
    expect(mediaTypeForExtension("mp3")).toBe("audio");
    expect(mediaTypeForExtension("mp4")).toBe("video");
  });

  it("returns null for non-asset or empty extensions", () => {
    expect(mediaTypeForExtension("html")).toBeNull();
    expect(mediaTypeForExtension("")).toBeNull();
  });
});
