# ADR-0002: Generalized media model via an additive migration

- Status: Accepted
- Date: 2026-05-22

## Context

v0.1's `documents` table assumed every item is a downloadable PDF: `r2_key` and
`http_status` are `NOT NULL`, `page_count` and OCR'd `pages` are expected. The new
sources break that assumption:

- Brazil SIAN has **photos, audio, drawings** — not just PDFs.
- Corbell's set includes **video references and leaked images**.
- Some items are **known to exist but not released** (UAP videos named in a
  congressional request) — they have no file to store at all.

We need `media_type` and a `status` (released vs. referenced-but-withheld) on
documents, plus the ability to store items with no original file.

The hard part is SQLite/D1 constraints. Making `r2_key`/`http_status` nullable
requires the 12-step table-rebuild (create new table, copy, **drop old**, rename),
because SQLite cannot relax a `NOT NULL` constraint in place. On D1 that rebuild
is dangerous: migrations run inside a transaction, where `PRAGMA foreign_keys=OFF`
is a **no-op**, and `DROP TABLE documents` performs an implicit `DELETE` that
**cascades** through the `ON DELETE CASCADE` foreign keys on `pages` and
`entities` — silently wiping all OCR text and entities. `PRAGMA
defer_foreign_keys` defers constraint *checks*, not cascade *actions*, so it does
not save us either.

## Decision

Do a **purely additive** migration ([`0001_multisource.sql`](../../packages/db/drizzle/0001_multisource.sql)):

- `ALTER TABLE documents ADD COLUMN` for `source_id` (default `'us-war-gov'`),
  `country`, `media_type` (default `'pdf'`), `status` (default `'released'`).
- Backfill `country = 'US'` for the existing corpus; add `source_id` / `country`
  / `status` indexes; add `crawl_runs.source_id`.
- **Keep `r2_key` and `http_status` NOT NULL.** Model the no-file cases with
  documented sentinels:
  - link-only media (audio/video): `r2_key = ""`, link out via `source_url`.
  - `referenced_withheld`: `r2_key = ""`, `http_status = 0` when never fetched.
- Items with no file content get a deterministic `sha256` from `syntheticSha([...])`.

Read `r2_key` truthiness (not null) to decide whether a stored original exists.

## Consequences

- **Positive**: zero risk of cascade-deleting `pages`/`entities`; the migration
  is a handful of safe `ADD COLUMN`s; no data movement; reversible in practice.
- **Negative**: two columns carry sentinel values (`""`, `0`) rather than `NULL`.
  This is documented in the schema and read through a single predicate
  (`r2_key !== ""` / `mediaType === "pdf"`), so it is an explicit convention, not
  a silent hack. If a future need demands true nullability, do the rebuild as its
  own migration with `PRAGMA foreign_keys=OFF` applied **outside** a transaction
  (e.g. a dedicated `wrangler d1 execute` step), not inside the migration runner.

## Alternatives considered

- **Table rebuild to relax NOT NULL**: the "clean" model, but unsafe under D1's
  transaction-wrapped migrations (see Context). Rejected for v0.2.
- **Separate `assets` table for non-PDF media**: cleaner column semantics, but
  every query and the dashboard would need a join, and `status` still belongs on
  the primary item. Rejected for complexity.
- **Skip non-PDF media entirely**: drops most of Brazil's visual archive and the
  withheld-items narrative. Rejected.
