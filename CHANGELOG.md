# Changelog

All notable changes to Blueport are documented here.
Format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Blueport uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-05-09

### Added

- **Bootstrap**: pnpm monorepo (`apps/web`, `apps/crawler`, `packages/db`) with TypeScript strict mode, Astro 5 + Tailwind frontend on Cloudflare Pages, Hono backend on Cloudflare Workers.
- **war.gov crawler**: cron-triggered Worker (every 6h via `0 */6 * * *`) scrapes the [war.gov/UFO/](https://www.war.gov/UFO/) index, extracts PDF hrefs, and iterates politely with a single identified `User-Agent`.
- **Hash-anchored R2 snapshots**: SHA-256 fingerprint computed from raw bytes before any parsing. PDFs stored at `docs/<sha256>.pdf` with `sourceUrl` and `fetchedAt` custom metadata. Objects are never overwritten.
- **SHA-256 dedup**: documents table keyed by `sha256`; re-fetching a known hash returns early without re-ingesting.
- **Hybrid OCR pipeline**: `unpdf` text-layer extraction first (free/fast); Claude Haiku PDF vision fallback for scans with fewer than 50 average chars/page (~$0.001/page). Per-page `<page n="X">…</page>` output parsed into structured rows.
- **Redaction detection**: `pages.has_redactions` flag set by pattern match on `[REDACTED]`, `████`, and `■■■` in page text.
- **Claude Haiku entity and summary extraction**: full document text (first 50,000 chars) sent to Claude Haiku for structured JSON extraction — title, doc type (`incident_report` | `memo` | `hearing` | `other`), document date, incident date, factual summary, and up to 30 named entities (`person`, `location`, `unit`, `craft`, `sensor`, `date`) with normalized canonical forms.
- **D1 schema** (`packages/db/drizzle/0000_init.sql`): `documents`, `pages`, `entities`, `crawl_runs` tables with indexes and foreign key cascades. FTS5 virtual table `pages_fts` with insert/delete/update sync triggers for v0.2 full-text search.
- **Astro pages**: `/` (landing), `/search` (query + filter UI), `/doc/[sha]` (document detail with page-anchored deep links), `/new` (what's new), `/rss.xml` (RSS 2.0 feed, one item per new document).
- **`/api/pdf/[sha]` R2 stream**: proxies the original PDF from R2 with `Cache-Control: public, max-age=31536000, immutable`.
- **`POST /admin/crawl`**: manual crawl trigger on the Worker, authenticated via bearer token.
- **One-shot provisioning**: `scripts/setup.sh` creates the D1 database (`blueport`), R2 bucket (`blueport-docs`), and Vectorize index (`blueport-pages`, 768d, cosine). Idempotent.
- **Migration script**: `scripts/migrate.sh` applies `0000_init.sql` to D1 (`--local` or `--remote`).
- **CI**: `.github/workflows/ci.yml` runs `pnpm typecheck` and `pnpm build` on every PR.
- **Release workflow**: `.github/workflows/release.yml` triggers on `v*` tags.
- **`ARCHITECTURE.md`**: system overview, data model, ingestion pipeline, hash-anchoring rationale, OCR strategy, search plan, provenance model, deploy topology, failure modes, and decisions log.
- **`CONTRIBUTING.md`**: local dev setup, branch and commit conventions, PR requirements, test expectations, connector contract sketch, AGPL note, and code of conduct.

### Decisions

- **Pivoted from "Bluebook" to "Blueport"**: every common `bluebook.*` TLD was squatted at time of registration. "Blueport" preserves the Project Blue Book lineage with port as observation point.
- **Deferred Workers AI Llama 3.2 Vision**: Cloudflare Workers have no native PDF rasterization service. Sending multi-page PDFs to a vision model requires per-page JPEG conversion unavailable in the Workers runtime. Deferred to v0.2 pending a rasterization solution.
- **Chose Astro over Next.js**: the archive is content-heavy, read-mostly, and needs native RSS generation. Astro's HTML-first output model and endpoint system are a better fit than a React SSR framework at this scale.

### Known gaps

- Vector search is not wired. The FTS5 virtual table and Vectorize index are provisioned, but Voyage-3 embeddings are not being generated. Full-text BM25 search is the only search path in v0.1.
- No authentication. All reads are public by design; saved searches and per-user alerts are deferred to v0.2.
- No email digest or X auto-poster. RSS is the sole distribution surface in v0.1.
- Incident graph (geocoded map, timeline, cross-source linking) is Phase 3.
- Redaction intelligence (CV-detected bars, type classification, FOIA archaeology) is Phase 4.
- `scripts/seed.sh` for local test data does not yet exist. Planned for v0.2.

[Unreleased]: https://github.com/sboghossian/blueport/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sboghossian/blueport/releases/tag/v0.1.0
