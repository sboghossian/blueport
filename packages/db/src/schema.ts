import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Media kinds an archived item can be. Non-PDF kinds skip page-level OCR. */
export type MediaType = "pdf" | "image" | "audio" | "video" | "webpage";

/**
 * Release state of an item.
 * - `released`: the original is public; we have (or link to) the file.
 * - `referenced_withheld`: the item is known to exist but has not been
 *   released (e.g. a UAP video named in a congressional request). It has no
 *   stored original — `r2Key` is empty and `httpStatus` is 0 when never fetched.
 */
export type DocStatus = "released" | "referenced_withheld";

export const documents = sqliteTable(
  "documents",
  {
    sha256: text("sha256").primaryKey(),
    // Stable connector id (e.g. "us-war-gov", "br-sian"). See @blueport/db/connectors.
    sourceId: text("source_id").notNull().default("us-war-gov"),
    sourceUrl: text("source_url").notNull(),
    sourceDomain: text("source_domain").notNull(),
    // ISO-3166 alpha-2 of the releasing government (US, BR, …). Nullable: unknown.
    country: text("country"),
    mediaType: text("media_type", {
      enum: ["pdf", "image", "audio", "video", "webpage"],
    })
      .notNull()
      .default("pdf"),
    status: text("status", { enum: ["released", "referenced_withheld"] })
      .notNull()
      .default("released"),
    title: text("title"),
    docType: text("doc_type"),
    pageCount: integer("page_count"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    documentDate: integer("document_date", { mode: "timestamp" }),
    incidentDate: integer("incident_date", { mode: "timestamp" }),
    httpStatus: integer("http_status").notNull(),
    // R2 object key of the stored original, or "" when nothing is stored
    // (link-only media + referenced_withheld items). Check truthiness, not null.
    r2Key: text("r2_key").notNull(),
    summary: text("summary"),
    skepticTake: text("skeptic_take"),
    analystTake: text("analyst_take"),
    publishedAt: integer("published_at", { mode: "timestamp" }),
  },
  (t) => ({
    sourceUrlIdx: index("documents_source_url_idx").on(t.sourceUrl),
    fetchedAtIdx: index("documents_fetched_at_idx").on(t.fetchedAt),
    documentDateIdx: index("documents_document_date_idx").on(t.documentDate),
    sourceIdIdx: index("documents_source_id_idx").on(t.sourceId),
    countryIdx: index("documents_country_idx").on(t.country),
    statusIdx: index("documents_status_idx").on(t.status),
  }),
);

export const pages = sqliteTable(
  "pages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docSha: text("doc_sha")
      .notNull()
      .references(() => documents.sha256, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull(),
    ocrModel: text("ocr_model").notNull(),
    ocrConfidence: integer("ocr_confidence"),
    hasRedactions: integer("has_redactions", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    docPageIdx: uniqueIndex("pages_doc_page_idx").on(t.docSha, t.pageNumber),
  }),
);

export const entities = sqliteTable(
  "entities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docSha: text("doc_sha")
      .notNull()
      .references(() => documents.sha256, { onDelete: "cascade" }),
    pageNumber: integer("page_number"),
    kind: text("kind", {
      enum: ["person", "location", "unit", "craft", "sensor", "date"],
    }).notNull(),
    value: text("value").notNull(),
    normalized: text("normalized"),
    lat: integer("lat"),
    lng: integer("lng"),
  },
  (t) => ({
    docIdx: index("entities_doc_idx").on(t.docSha),
    kindIdx: index("entities_kind_idx").on(t.kind),
    valueIdx: index("entities_value_idx").on(t.normalized),
  }),
);

export const crawlRuns = sqliteTable("crawl_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  // Connector id for this run (nullable: pre-v0.2 rows only have sourceDomain).
  sourceId: text("source_id"),
  sourceDomain: text("source_domain").notNull(),
  newDocuments: integer("new_documents").notNull().default(0),
  updatedDocuments: integer("updated_documents").notNull().default(0),
  errors: text("errors"),
});
