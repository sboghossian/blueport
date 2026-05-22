# Architecture

Blueport is a Cloudflare-native monorepo. The crawler Worker iterates a **connector registry** of government/source releases, ingests and OCRs their documents (and links their non-PDF media), and extracts metadata; the Astro frontend reads from D1 and R2 to serve search, document pages, RSS, and a release-activity dashboard. Every component runs at the Cloudflare edge with no external infrastructure outside the Anthropic Claude API and Cloudflare Browser Rendering.

Two ingestion runtimes sit behind one registry: a **fetch** path (plain `fetch()` over static HTML portals → `.pdf` links) and a **browser** path (Cloudflare Browser Rendering / headless Chrome for JS-rendered or session-gated archives). See [ADR-0001](docs/adr/0001-multi-source-connector-registry.md) and [ADR-0002](docs/adr/0002-additive-media-migration.md).

## System overview

```mermaid
graph LR
    WAR["war.gov/UFO/\n(source index)"]
    CRAWLER["Crawler Worker\n(Hono + cron)"]
    R2["R2\ndocs/<sha256>.pdf"]
    OCR["OCR\nunpdf | Claude Haiku PDF"]
    EXTRACT["Claude Haiku\nentity extraction"]
    D1["D1\n(SQLite + FTS5)"]
    VECTORIZE["Vectorize\nblueport-pages"]
    WEB["Astro on Pages\nblueport.dashable.dev"]
    USER["User"]

    WAR -->|"poll every 6h"| CRAWLER
    CRAWLER -->|"PUT docs/<sha>.pdf"| R2
    CRAWLER --> OCR
    OCR -->|"page text"| EXTRACT
    OCR -->|"page embeddings (v0.2)"| VECTORIZE
    EXTRACT --> D1
    OCR --> D1
    D1 --> WEB
    R2 -->|"/api/pdf/[sha]"| WEB
    WEB --> USER
```

## Data model

The schema lives in [`packages/db/src/schema.ts`](packages/db/src/schema.ts). The SQL migration that creates the tables, indexes, FTS5 virtual table, and sync triggers is [`packages/db/drizzle/0000_init.sql`](packages/db/drizzle/0000_init.sql).

### documents

One row per unique item, keyed by `sha256` (content hash for stored files; a deterministic synthetic hash for link-only and withheld items). Stores connector identity (`source_id`, `country`), provenance (`source_url`, `source_domain`, `fetched_at`, `http_status`, `r2_key`), the media model (`media_type` ∈ {pdf, image, audio, video, webpage}; `status` ∈ {released, referenced_withheld}), and extracted metadata (`title`, `doc_type`, `page_count`, `document_date`, `incident_date`, `summary`). The `skeptic_take`/`analyst_take` columns are reserved for the dual-take generator (Opus). `published_at` gates RSS visibility.

`r2_key` and `http_status` are NOT NULL by design (see ADR-0002): link-only media uses `r2_key = ""` (and links out via `source_url`), and `referenced_withheld` items use `r2_key = ""` with `http_status = 0` when never fetched. Read `r2_key` truthiness, not null.

Indexes on `source_url`, `fetched_at`, `document_date`, `source_id`, `country`, and `status` cover dedup lookup, chronological listing, date-range filtering, and the per-source / per-country / released-vs-withheld dashboard aggregations.

### pages

One row per page per document. Foreign key to `documents.sha256` with `ON DELETE CASCADE` — dropping a document clears its pages automatically. The unique index on `(doc_sha, page_number)` prevents duplicates on re-ingestion. `ocr_model` records which path produced the text (`unpdf-textlayer` or `claude-haiku-4-5`). `has_redactions` is a boolean set during OCR by pattern match.

### entities

Named entities extracted by Claude Haiku. Foreign key to `documents.sha256` with `ON DELETE CASCADE`. `kind` is an enum: `person`, `location`, `unit`, `craft`, `sensor`, `date`. `value` preserves the string as it appears in the document; `normalized` stores the canonical form used for deduplication and cross-document linking. `lat`/`lng` are reserved for Phase 3 geocoding.

Indexes on `doc_sha`, `kind`, and `normalized` support per-document entity listing, kind filtering, and entity-level cross-document search.

### crawl_runs

One row per connector per cron invocation. Records `started_at`, `finished_at`, `source_id`, `source_domain`, `new_documents`, `updated_documents`, and a JSON `errors` array. Used for monitoring and the "last verified" / "last fetched" badges.

## Sources & connectors

Sources live in the registry [`packages/db/src/connectors.ts`](packages/db/src/connectors.ts), shared by the crawler (behavior) and the web app (labels/colors). Each `Connector` declares `id`, `label`, `country`, `kind` (`fetch` | `browser`), `startUrls`, `allowedHosts` (SSRF allowlist), and optional `seedReferenced` items.

| id | country | kind | what |
|---|---|---|---|
| `us-war-gov` | US | fetch | DoW war.gov/UFO PURSUE release |
| `us-nara` | US | fetch | National Archives UAP records |
| `br-sian` | BR | browser | Brazil Arquivo Nacional (SIAN) |
| `corbell-sleeping-dog` | US | browser | Jeremy Corbell / *Sleeping Dog* leak set |

`seedReferenced` entries must carry a verifiable public `sourceUrl`; filenames are never fabricated (enforced by a registry test).

## Ingestion pipeline

`runCrawl` iterates `CONNECTORS`; each becomes a `crawl_runs` row and a `crawlConnector` call. Steps map to files in `apps/crawler/src/`.

1. **Discover** (`crawl.ts` → `discover`):
   - `fetch` kind: GET each `startUrl` with a single identifiable `User-Agent` (one request at a time) and parse `.pdf` links via `extractPdfUrls`, resolved against the base and SSRF-filtered by the connector's `allowedHosts`.
   - `browser` kind: dynamically import `browser.ts` → `discoverViaBrowser`, which launches Cloudflare Browser Rendering, `page.goto` + `page.content()` per start URL, then `assets.ts` → `extractAssetLinks` harvests `.pdf/.jpg/.mp3/.mp4/…` links (same host + extension rules). `seedReferenced` items are appended as `referenced_withheld` assets.

2. **Classify** (`assets.ts` → `classifyAssetUrl`): map extension → `media_type`. PDFs/images are flagged `download: true`; audio/video are link-only.

3. **Ingest** (`crawl.ts` → `ingestAsset`), branching on status/media:
   - `ingestFile` (pdf/image): fetch bytes → SHA-256 (`sha256`) → dedup → `PUT docs/<sha>.<ext>` (never overwritten) → for PDFs, OCR + entity extraction.
   - `ingestLinked` (audio/video/webpage): record with `r2_key = ""`, deterministic `syntheticSha`.
   - `ingestReferenced` (withheld): record with `r2_key = ""`, `status = referenced_withheld`, synthetic hash.

4. **OCR** (`ocr.ts` → `ocrPdf`): `unpdf` text-layer first; below 50 avg chars/page, fall back to `claudePdfOcr` (base64 PDF → Claude Haiku → `<page n="X">…</page>`). Redactions flagged via `detectRedactions`.

5. **Entity extraction** (`extract.ts` → `extract`): first 50,000 chars → Claude Haiku → `title`, `docType`, dates, `summary`, up to 30 entities.

6. **D1 writes**: one `documents` row, batch `pages`, batch `entities`. FTS5 sync triggers keep `pages_fts` current.

7. **Run update**: update the connector's `crawl_runs` row with `finishedAt`, counts, and errors. A failing connector logs to its own run and never aborts the others.

## Release activity dashboard

`/activity` ([`apps/web/src/pages/activity.astro`](apps/web/src/pages/activity.astro)) aggregates via [`lib/activity.ts`](apps/web/src/lib/activity.ts) (`getActivitySummary`): counts by `source_id` + `country`, a per-day × per-source timeline (`strftime(... ,'unixepoch')`), and released-vs-withheld totals. It renders dependency-free inline SVG: a stacked timeline, a world bubble-map ([`WorldMap.astro`](apps/web/src/components/WorldMap.astro) + [`lib/geo.ts`](apps/web/src/lib/geo.ts), equirectangular projection over country centroids), per-source cards, counters, and a merged feed. Source colors are shared between chart and map via `SOURCE_COLORS`.

## Hash-anchoring

Every PDF is stored at the path `docs/<sha256>.pdf`. The SHA-256 is computed from the raw bytes before any parsing, making it a content-addressed key that is independent of the source URL or fetch timestamp.

Consequences:

- If war.gov silently modifies a document (redacts more, corrects a date), the hash changes and Blueport ingests it as a new document. The old version remains in R2. Both are queryable.
- A document moved to a different URL but with identical content will match the existing hash and be skipped — dedup is content-based, not URL-based.
- R2 objects are immutable in practice. No `PUT` ever targets an existing key. The full history of a document's published forms is preserved as a sequence of hashes.

Phase 4 redaction archaeology depends on this: to find passages that were redacted in one release and unredacted in another, Blueport will diff the page text of two versions of the same logical document across their two hashes.

## OCR strategy

The pipeline uses a two-stage hybrid:

1. **`unpdf` text-layer** (free, ~0ms overhead): most Pentagon PDFs contain an embedded text layer from the original authoring tool. If the average character count per page exceeds 50, this text is used directly. Cost: zero.

2. **Claude Haiku PDF vision fallback** (~$0.001/page): for scanned documents with no text layer (or a sparse one), the raw PDF bytes are base64-encoded and sent to Claude Haiku as a `document` content block. Claude returns a structured page-tagged transcript. Cost at war.gov archive scale: estimated $1–5 total for the initial backfill.

Workers AI Llama 3.2 Vision is deferred to a future release. Cloudflare Workers have no native PDF rasterization service, and sending multi-page PDFs to a vision model requires per-page JPEG conversion that is not available in the Workers runtime today.

## Search

v0.1 ships BM25 full-text search via the `pages_fts` FTS5 virtual table created in `0000_init.sql`. The table is an external-content FTS5 backed by `pages`, with insert/delete/update triggers that keep it synchronized. The tokenizer is `porter unicode61`.

v0.2 will add Voyage-3 vector embeddings (768d, cosine) stored in the `blueport-pages` Vectorize index. Search will become hybrid: FTS5 BM25 score fused with Vectorize cosine similarity. The Vectorize binding is already declared in `apps/crawler/wrangler.toml` and the index is provisioned by `scripts/setup.sh`.

## Provenance and trust

Blueport's trust model rests on three properties:

- **Hash visibility**: every document page shows its SHA-256. A reader can download the original PDF from `/api/pdf/[sha]` and verify the hash independently.
- **Immutable R2 cache**: the `/api/pdf/[sha]` route streams the original bytes from R2 with `Cache-Control: public, max-age=31536000, immutable`. The URL is permanently stable because the content is content-addressed.
- **Open ingestion pipeline**: the code that fetches, hashes, OCRs, and extracts every document is this repository. An auditor can read `apps/crawler/src/` end to end and reproduce any ingestion result.

The "last verified against war.gov on YYYY-MM-DD" badge on each document page is sourced from the most recent `crawl_runs` row for the document's `source_domain`.

## Deploy topology

```mermaid
graph TD
    PAGES["Cloudflare Pages\n@blueport/web"]
    WORKER["Cloudflare Worker\nblueport-crawler"]
    D1["D1\ndatabase: blueport"]
    R2["R2\nbucket: blueport-docs"]
    VECTORIZE["Vectorize\nindex: blueport-pages"]
    AI["Workers AI binding\n(reserved)"]
    ANTHROPIC["Anthropic API\n(external)"]

    PAGES -->|"D1 binding (read)"| D1
    PAGES -->|"R2 binding (stream)"| R2
    WORKER -->|"cron: 0 */6 * * *"| WORKER
    WORKER -->|"D1 binding (read/write)"| D1
    WORKER -->|"R2 binding (write)"| R2
    WORKER -->|"Vectorize binding"| VECTORIZE
    WORKER -->|"AI binding (reserved)"| AI
    WORKER -->|"ANTHROPIC_API_KEY secret"| ANTHROPIC
```

The cron trigger runs at `0 */6 * * *` (every 6 hours) and is declared in `apps/crawler/wrangler.toml`. The manual trigger endpoint `POST /admin/crawl` is authenticated via the `ANTHROPIC_API_KEY` header for operator use.

## Failure modes and mitigations

| Failure | Blast radius | Mitigation |
|---|---|---|
| war.gov rate-limits or blocks the crawler | Crawl run fails; no new docs ingested | Single User-Agent (`BlueportBot/0.1`), no parallelism, polite headers. Errors logged per URL in `crawl_runs.errors`. Retry on next cron tick. |
| OCR low-confidence on scanned pages | Pages indexed with sparse or garbled text | `ocr_confidence` column tracked; low-confidence pages flagged for human review in v0.2. |
| Anthropic API outage | Entity extraction and/or OCR fallback unavailable | Text-layer OCR succeeds independently. Documents with no text layer are skipped and retried on next cron run. |
| R2 write failure | Document not stored; ingestion aborts | Error recorded in `crawl_runs.errors`. Hash not written to D1. Next cron re-fetches and retries from scratch. |
| D1 write failure | Pages and entities not written | Partial write rolled back implicitly (D1 is SQLite). Re-ingestion is idempotent: hash dedup catches the retry. |
| Viral traffic spike driving R2 egress | Cost spike on PDF streaming | `Cache-Control: immutable` on `/api/pdf/[sha]`. Cloudflare CDN caches the response after first hit. No R2 egress on cache hits. |

## Decisions log

| Decision | Choice | Rationale |
|---|---|---|
| Infrastructure | Cloudflare-everything (Pages, Workers, D1, R2, Vectorize) | Single-vendor, zero-egress between services, generous free tier, cron triggers and R2 content-addressed storage are native fits for this use case. |
| Frontend framework | Astro over Next.js | Content-heavy static site with RSS. Astro's output model (HTML-first, island hydration) gives the fastest TTFB for a read-heavy archive. RSS generation is a first-class Astro endpoint. |
| License | AGPL-3.0-only | Ingestion pipeline correctness is a trust property. AGPL ensures any service operator running a fork must publish their modifications. |
| OCR | Hybrid unpdf + Claude Haiku | unpdf covers the majority of docs at zero cost. Claude Haiku PDF vision handles scans at ~$0.001/page. Workers AI Llama 3.2 Vision deferred: no PDF rasterization in the Workers runtime. |
| Auth | None in v0.1 | The archive is public domain source material. Adding auth before there is anything worth protecting creates friction with no benefit. Clerk deferred to v0.2 for saved searches and alerts. |
| Embeddings | Voyage-3 (planned) | 768d, cosine metric. Anthropic's recommended embedding family for document corpora. Vectorize index and binding are pre-provisioned; wiring deferred until FTS5 search is validated at scale. |
| Sources | Connector registry + hybrid fetch/browser runtime (ADR-0001) | One registry drives both static-portal `fetch()` crawling and Cloudflare Browser Rendering for JS/auth sites. Adding a release = one entry. Keeps the proven fetch path untouched. |
| Media + withheld model | Generalize `documents`, additive migration (ADR-0002) | `media_type` + `status` make non-PDF media and known-but-unreleased items first-class. Migration is additive `ADD COLUMN` only — a table rebuild would risk D1 FK cascade-on-drop wiping `pages`/`entities`. |
| World map | Centroid bubble-map, inline SVG | A polygon choropleth needs TopoJSON + a map lib. A bubble-map over country centroids is dependency-free, scales to N countries, and reads clearly on the dark theme. |
