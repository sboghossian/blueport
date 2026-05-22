import { describe, it, expect } from "vitest";
import {
  CONNECTORS,
  getConnector,
  isHostAllowed,
  mediaTypeForExtension,
} from "../src/connectors.js";

describe("connector registry", () => {
  it("defines the four v0.2 sources in registry order", () => {
    expect(CONNECTORS.map((c) => c.id)).toEqual([
      "us-war-gov",
      "us-nara",
      "br-sian",
      "corbell-sleeping-dog",
    ]);
  });

  it("has unique connector ids", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every connector has start urls, allowed hosts, and a valid kind", () => {
    for (const c of CONNECTORS) {
      expect(c.startUrls.length).toBeGreaterThan(0);
      expect(c.allowedHosts.length).toBeGreaterThan(0);
      expect(["fetch", "browser"]).toContain(c.kind);
    }
  });

  it("every start url lives under the connector's own allowed hosts", () => {
    for (const c of CONNECTORS) {
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
