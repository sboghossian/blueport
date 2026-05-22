import { describe, it, expect, expectTypeOf } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import {
  documents,
  pages,
  entities,
  crawlRuns,
} from "../src/schema.js";

describe("schema: documents", () => {
  it("has expected columns defined on the table object", () => {
    expect(documents.sha256).toBeDefined();
    expect(documents.sourceUrl).toBeDefined();
    expect(documents.sourceDomain).toBeDefined();
    expect(documents.title).toBeDefined();
    expect(documents.docType).toBeDefined();
    expect(documents.pageCount).toBeDefined();
    expect(documents.fetchedAt).toBeDefined();
    expect(documents.documentDate).toBeDefined();
    expect(documents.incidentDate).toBeDefined();
    expect(documents.r2Key).toBeDefined();
  });

  it("uses sha256 as the primary key", () => {
    const config = getTableConfig(documents);
    const pk = config.columns.find((c) => c.primary);
    expect(pk?.name).toBe("sha256");
  });

  it("infers a Select row with correct types", () => {
    type Row = typeof documents.$inferSelect;
    expectTypeOf<Row["sha256"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["sourceUrl"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["sourceDomain"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["fetchedAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<Row["title"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Row["documentDate"]>().toEqualTypeOf<Date | null>();
  });

  it("has the v0.2 multi-source columns", () => {
    expect(documents.sourceId).toBeDefined();
    expect(documents.country).toBeDefined();
    expect(documents.mediaType).toBeDefined();
    expect(documents.status).toBeDefined();
  });

  it("infers mediaType and status as literal unions, country nullable", () => {
    type Row = typeof documents.$inferSelect;
    expectTypeOf<Row["sourceId"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["country"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Row["mediaType"]>().toEqualTypeOf<
      "pdf" | "image" | "audio" | "video" | "webpage"
    >();
    expectTypeOf<Row["status"]>().toEqualTypeOf<"released" | "referenced_withheld">();
  });
});

describe("schema: pages", () => {
  it("has expected columns and a hasRedactions boolean", () => {
    expect(pages.id).toBeDefined();
    expect(pages.docSha).toBeDefined();
    expect(pages.pageNumber).toBeDefined();
    expect(pages.text).toBeDefined();
    expect(pages.ocrModel).toBeDefined();
    expect(pages.hasRedactions).toBeDefined();
  });

  it("infers hasRedactions as boolean on Select", () => {
    type Row = typeof pages.$inferSelect;
    expectTypeOf<Row["hasRedactions"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Row["pageNumber"]>().toEqualTypeOf<number>();
    expectTypeOf<Row["text"]>().toEqualTypeOf<string>();
  });
});

describe("schema: entities", () => {
  it("has expected columns including kind enum", () => {
    expect(entities.id).toBeDefined();
    expect(entities.docSha).toBeDefined();
    expect(entities.kind).toBeDefined();
    expect(entities.value).toBeDefined();
    expect(entities.normalized).toBeDefined();
  });

  it("infers kind as the literal union", () => {
    type Row = typeof entities.$inferSelect;
    expectTypeOf<Row["kind"]>().toEqualTypeOf<
      "person" | "location" | "unit" | "craft" | "sensor" | "date"
    >();
  });
});

describe("schema: crawlRuns", () => {
  it("has expected columns including the v0.2 source_id", () => {
    expect(crawlRuns.id).toBeDefined();
    expect(crawlRuns.startedAt).toBeDefined();
    expect(crawlRuns.finishedAt).toBeDefined();
    expect(crawlRuns.sourceId).toBeDefined();
    expect(crawlRuns.sourceDomain).toBeDefined();
    expect(crawlRuns.newDocuments).toBeDefined();
    expect(crawlRuns.updatedDocuments).toBeDefined();
  });

  it("infers required Insert fields", () => {
    type Insert = typeof crawlRuns.$inferInsert;
    expectTypeOf<Insert["startedAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<Insert["sourceDomain"]>().toEqualTypeOf<string>();
    // newDocuments has a default — it must be assignable from a row that
    // omits the field. This proves the column is optional on insert.
    const row: Insert = { startedAt: new Date(), sourceDomain: "war.gov" };
    expect(row.sourceDomain).toBe("war.gov");
  });
});
