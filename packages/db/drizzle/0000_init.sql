-- Blueport initial schema (D1 / SQLite)
-- Mirrors packages/db/src/schema.ts exactly.
-- Idempotent: every CREATE uses IF NOT EXISTS so re-running is safe.

CREATE TABLE IF NOT EXISTS `documents` (
  `sha256` text PRIMARY KEY NOT NULL,
  `source_url` text NOT NULL,
  `source_domain` text NOT NULL,
  `title` text,
  `doc_type` text,
  `page_count` integer,
  `fetched_at` integer NOT NULL,
  `document_date` integer,
  `incident_date` integer,
  `http_status` integer NOT NULL,
  `r2_key` text NOT NULL,
  `summary` text,
  `skeptic_take` text,
  `analyst_take` text,
  `published_at` integer
);

CREATE INDEX IF NOT EXISTS `documents_source_url_idx` ON `documents` (`source_url`);
CREATE INDEX IF NOT EXISTS `documents_fetched_at_idx` ON `documents` (`fetched_at`);
CREATE INDEX IF NOT EXISTS `documents_document_date_idx` ON `documents` (`document_date`);

CREATE TABLE IF NOT EXISTS `pages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `doc_sha` text NOT NULL,
  `page_number` integer NOT NULL,
  `text` text NOT NULL,
  `ocr_model` text NOT NULL,
  `ocr_confidence` integer,
  `has_redactions` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`doc_sha`) REFERENCES `documents`(`sha256`) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `pages_doc_page_idx` ON `pages` (`doc_sha`, `page_number`);

CREATE TABLE IF NOT EXISTS `entities` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `doc_sha` text NOT NULL,
  `page_number` integer,
  `kind` text NOT NULL,
  `value` text NOT NULL,
  `normalized` text,
  `lat` integer,
  `lng` integer,
  FOREIGN KEY (`doc_sha`) REFERENCES `documents`(`sha256`) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `entities_doc_idx` ON `entities` (`doc_sha`);
CREATE INDEX IF NOT EXISTS `entities_kind_idx` ON `entities` (`kind`);
CREATE INDEX IF NOT EXISTS `entities_value_idx` ON `entities` (`normalized`);

CREATE TABLE IF NOT EXISTS `crawl_runs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `started_at` integer NOT NULL,
  `finished_at` integer,
  `source_domain` text NOT NULL,
  `new_documents` integer DEFAULT 0 NOT NULL,
  `updated_documents` integer DEFAULT 0 NOT NULL,
  `errors` text
);

-- Full-text search over page text (v0.2 search path).
-- External-content FTS5 table backed by `pages`; row id maps to pages.id.
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  text,
  content='pages',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Sync triggers keep pages_fts in lockstep with pages.
CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, text) VALUES('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO pages_fts(rowid, text) VALUES (new.id, new.text);
END;
