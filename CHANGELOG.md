# Changelog

All notable changes to Blueport are documented here.
Format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Blueport uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Multi-source connector registry** ([`packages/db/src/connectors.ts`](packages/db/src/connectors.ts)): the single hardcoded war.gov crawler is now a registry of typed connectors. Four sources ship: `us-war-gov` (PURSUE 2nd release), `us-nara` (National Archives), `br-sian` (Brazil's Arquivo Nacional), and `corbell-sleeping-dog` (Jeremy Corbell / *Sleeping Dog* leak set). Adding a government release is one registry entry.
- **Hybrid scrape runtime**: `fetch`-kind connectors crawl static portals with plain `fetch()`; `browser`-kind connectors render JS/session-gated sites with **Cloudflare Browser Rendering** (`@cloudflare/puppeteer`, `[browser]` binding — Workers Paid plan). Browser code is dynamically imported so the fetch path and unit tests never load it.
- **Generalized media model**: `documents` gains `source_id`, `country`, `media_type` (`pdf` | `image` | `audio` | `video` | `webpage`), and `status` (`released` | `referenced_withheld`). PDFs/images are stored in R2; audio/video are link-only. Items known-but-unreleased (e.g. UAP videos named in a congressional request) are first-class `referenced_withheld` rows — seeded only from verifiable references, never fabricated.
- **Release-activity dashboard** at `/activity`: released-vs-withheld + country counters, an SVG **world bubble-map** of releases by country, a stacked per-source **releases-over-time** timeline, per-source cards (released / withheld / this-week / last-fetched), and a merged "what's new" feed. Dependency-free inline SVG charts.
- **Schema migration** `packages/db/drizzle/0001_multisource.sql`: purely additive `ALTER TABLE ADD COLUMN` (no table rebuild) plus new indexes; backfills existing rows to `country = 'US'`. `crawl_runs` gains `source_id` for per-connector run tracking.
- **Asset link parser** (`apps/crawler/src/assets.ts`): pure, DOM-free extraction of asset links from rendered HTML, reusing the same SSRF host-allowlist + extension rules as the fetch path.
- **Tests**: connector registry integrity + host guard + media-type mapping, asset extraction, `syntheticSha` determinism, activity color/geo helpers, and new schema columns. Suite now 79 tests.

### Changed

- `runCrawl` iterates all connectors and aggregates per-connector results; `CrawlResult` now carries a `connectors[]` breakdown. R2 keys are `docs/<sha256>.<ext>` (was always `.pdf`).
- `DocCard` and the document page surface source label, country, media type, and a `withheld` badge; the document page links to the original only when a stored PDF exists, otherwise to source (link-only) or shows a "not released" note.
- `scripts/migrate.sh` applies every `drizzle/*.sql` migration in lexical order (was `0000_init.sql` only).
- Crawler `User-Agent` bumped to `BlueportBot/0.2`. Removed the now-unused `SOURCE_INDEX_URL` / `ALLOWED_SOURCE_HOSTS` vars (sources live in the registry).

### Decisions

- **Additive migration over table rebuild** (ADR-0002): relaxing a NOT NULL column in SQLite needs a DROP/recreate, but on D1 migrations run inside a transaction where `PRAGMA foreign_keys=OFF` is a no-op — so the implicit DELETE on DROP would cascade-wipe `pages`/`entities`. We keep `r2_key`/`http_status` NOT NULL and use documented sentinels (`""` / `0`) for link-only and withheld items.
- **Hybrid connector runtime** (ADR-0001): keep the proven fetch path for static portals; add Browser Rendering only for sources that genuinely need a headless browser.

### Known gaps

- SIAN + Corbell `startUrls` and DOM entry points are best-known but not yet end-to-end DOM-verified against the live sites; the browser connector harvests asset links generically and degrades gracefully, but first-run output should be reviewed.
- SIAN may require an account to browse; the connector does **not** auto-register accounts.
- The world map is a centroid bubble-map (not a polygon choropleth) to stay dependency-free.

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
