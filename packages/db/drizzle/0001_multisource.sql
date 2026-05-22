-- Blueport v0.2 — multi-source expansion.
-- Adds connector identity (source_id), releasing country, and a generalized
-- media model (media_type + status) to `documents`; adds source_id to
-- `crawl_runs`. Mirrors packages/db/src/schema.ts.
--
-- DESIGN: purely additive `ALTER TABLE ADD COLUMN`. No table rebuild — relaxing
-- a NOT NULL column in SQLite requires DROP/recreate, and on D1 the migration
-- runs inside a transaction where `PRAGMA foreign_keys=OFF` is a no-op, so the
-- implicit DELETE on DROP would cascade-wipe `pages`/`entities`. We therefore
-- keep r2_key/http_status NOT NULL and use documented sentinels ("" / 0) for
-- link-only and referenced_withheld items.
--
-- NOT idempotent: ADD COLUMN errors if the column already exists. Apply once
-- per database (after 0000_init.sql).

ALTER TABLE `documents` ADD COLUMN `source_id` text DEFAULT 'us-war-gov' NOT NULL;
ALTER TABLE `documents` ADD COLUMN `country` text;
ALTER TABLE `documents` ADD COLUMN `media_type` text DEFAULT 'pdf' NOT NULL;
ALTER TABLE `documents` ADD COLUMN `status` text DEFAULT 'released' NOT NULL;

-- Backfill: the entire pre-v0.2 corpus is war.gov / US.
UPDATE `documents` SET `country` = 'US' WHERE `country` IS NULL;

CREATE INDEX IF NOT EXISTS `documents_source_id_idx` ON `documents` (`source_id`);
CREATE INDEX IF NOT EXISTS `documents_country_idx` ON `documents` (`country`);
CREATE INDEX IF NOT EXISTS `documents_status_idx` ON `documents` (`status`);

ALTER TABLE `crawl_runs` ADD COLUMN `source_id` text;
