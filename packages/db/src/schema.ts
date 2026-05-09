import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable(
  "documents",
  {
    sha256: text("sha256").primaryKey(),
    sourceUrl: text("source_url").notNull(),
    sourceDomain: text("source_domain").notNull(),
    title: text("title"),
    docType: text("doc_type"),
    pageCount: integer("page_count"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    documentDate: integer("document_date", { mode: "timestamp" }),
    incidentDate: integer("incident_date", { mode: "timestamp" }),
    httpStatus: integer("http_status").notNull(),
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
  sourceDomain: text("source_domain").notNull(),
  newDocuments: integer("new_documents").notNull().default(0),
  updatedDocuments: integer("updated_documents").notNull().default(0),
  errors: text("errors"),
});
