import { describe, it, expect } from "vitest";
import { scoreDocument, agencyOf, tierFor } from "../src/lib/credibility.js";
import type { documents } from "@blueport/db/schema";

type Doc = typeof documents.$inferSelect;

function doc(over: Partial<Doc>): Doc {
  return {
    sha256: "x",
    sourceId: "pursue-archive",
    sourceUrl: "https://example/i.json",
    sourceDomain: "github.com/Pump-OS/alien-files",
    country: "US",
    mediaType: "pdf",
    status: "released",
    title: null,
    docType: "other",
    pageCount: null,
    fetchedAt: new Date(),
    documentDate: null,
    incidentDate: null,
    httpStatus: 200,
    r2Key: "",
    summary: null,
    skepticTake: null,
    analystTake: null,
    publishedAt: null,
    ...over,
  } as Doc;
}

describe("agencyOf", () => {
  it("reads the [Agency] title prefix", () => {
    expect(agencyOf(doc({ title: "[FBI] Photo B12" }))).toBe("FBI");
    expect(agencyOf(doc({ title: "[Department of War] x" }))).toBe("Department of War");
  });
  it("maps the AARO connector id when there's no prefix", () => {
    expect(agencyOf(doc({ sourceId: "us-aaro", title: "UAP Trends" }))).toBe("AARO");
  });
});

describe("tierFor", () => {
  it("bands scores", () => {
    expect(tierFor(85)).toBe("Strong");
    expect(tierFor(55)).toBe("Moderate");
    expect(tierFor(20)).toBe("Weak");
  });
});

describe("scoreDocument", () => {
  it("rates a rich primary-source doc Strong", () => {
    const c = scoreDocument(
      doc({
        title: "[Department of War] UAP brief",
        pageCount: 12,
        documentDate: new Date("2023-07-10"),
        incidentDate: new Date("2023-07-01"),
        status: "released",
        summary: "Substantive multi-page briefing on UAP operations.",
      }),
    );
    expect(c.score).toBeGreaterThanOrEqual(70);
    expect(c.tier).toBe("Strong");
    expect(c.factors).toHaveLength(4);
  });

  it("rates a blank/image-only slide low on content", () => {
    const c = scoreDocument(
      doc({
        title: "[Department of War] AARO Mission Brief",
        pageCount: 0,
        summary: "No document content was provided for extraction.",
      }),
    );
    const content = c.factors.find((f) => f.label === "Primary content");
    expect(content?.points).toBeLessThanOrEqual(6);
  });

  it("penalizes referenced-but-withheld provenance", () => {
    const released = scoreDocument(doc({ status: "released", pageCount: 3 }));
    const withheld = scoreDocument(doc({ status: "referenced_withheld", pageCount: 0 }));
    expect(withheld.score).toBeLessThan(released.score);
  });

  it("never exceeds 100 or drops below 0", () => {
    const c = scoreDocument(
      doc({ sourceId: "us-aaro", title: "AARO", pageCount: 99, documentDate: new Date(), incidentDate: new Date() }),
    );
    expect(c.score).toBeLessThanOrEqual(100);
    expect(c.score).toBeGreaterThanOrEqual(0);
  });
});
