# Blueport

The source-grounded archive of UAP/UFO documents released by governments.

> Lineage: [Project Blue Book](https://en.wikipedia.org/wiki/Project_Blue_Book), the USAF UAP investigation 1952–1969. The name pivoted from "Bluebook" after every common `bluebook.*` TLD was squatted; Blueport keeps the reference, with port as observation point.

## What this is

Blueport crawls government-released UAP/UFO documents across **multiple sources** — the Pentagon's rolling release at [war.gov/UFO/](https://www.war.gov/UFO/), the US National Archives, Brazil's national archive (SIAN), and the Jeremy Corbell / *Sleeping Dog* leak set — OCRs them, hash-anchors the originals to R2, runs entity extraction, and exposes the corpus through full-text search, page-anchored deep links, per-document provenance, an RSS feed, and a **release-activity dashboard** showing what is releasing, when, and from where.

Sources are defined in a **connector registry** ([`packages/db/src/connectors.ts`](packages/db/src/connectors.ts)). Static government portals are crawled with plain `fetch()`; JS-rendered / session-gated archives (SIAN, Corbell) are rendered with **Cloudflare Browser Rendering** (headless Chrome). Adding a new government release is a one-line registry entry.

Every claim cites a page. No editorial framing. The ingestion pipeline is AGPL-3.0 by design: trust requires an auditable open-source record of how each document entered the archive, what was extracted from it, and whether it has changed since first fetch.

## Status

Pre-alpha. See [tasks/todo.md](tasks/todo.md) for the live plan and acceptance criteria.

## Stack

- **Frontend**: Astro 5 + Tailwind on Cloudflare Pages
- **Backend**: Hono on Cloudflare Workers (cron-driven multi-source crawler + API)
- **Scraping**: hybrid — plain `fetch()` for static portals, **Cloudflare Browser Rendering** (`@cloudflare/puppeteer`, headless Chrome) for JS/session-gated sources (Workers Paid plan)
- **DB**: Cloudflare D1 (SQLite + FTS5)
- **Vector**: Cloudflare Vectorize (Voyage-3, 768d, cosine — wired in a later release)
- **Storage**: Cloudflare R2 (originals, hash-anchored at `docs/<sha256>.<ext>`)
- **OCR**: hybrid — `unpdf` text-layer first (free/fast), Claude Haiku PDF vision fallback (~$0.001/page) for scanned documents
- **LLM**: Anthropic Claude — Haiku for entity extraction, Sonnet for summaries (v0.2), Opus for contradiction view (v0.4)
- **Embeddings**: Voyage-3 planned (v0.2)
- **License**: [AGPL-3.0-only](LICENSE)

## Repo layout

```
apps/
  web/      Astro frontend on Cloudflare Pages
            /activity dashboard (timeline + world map + source cards + feed),
            search, doc pages, RSS
  crawler/  Worker with cron + Hono — iterates the connector registry,
            hash-anchors to R2, OCRs (unpdf + Claude PDF), entity-extracts
            (Claude Haiku), inserts documents/pages/entities into D1
            src/connectors via @blueport/db · assets.ts (link parsing) ·
            browser.ts (Cloudflare Browser Rendering)
packages/
  db/       Drizzle schema + connector registry (connectors.ts) + migrations
scripts/
  setup.sh    One-time Cloudflare resource provisioning
  migrate.sh  Apply all D1 migrations in order
docs/adr/   Architecture decision records
.github/workflows/
  ci.yml      Typecheck + build on PR
  release.yml Release on v* tags
tasks/
  todo.md   Plan source of truth
```

## Setup

```sh
git clone https://github.com/sboghossian/blueport.git
cd blueport
pnpm install
cp apps/crawler/.dev.vars.example apps/crawler/.dev.vars
# Edit apps/crawler/.dev.vars and set ANTHROPIC_API_KEY
pnpm dev          # Astro web dev server on :4321
pnpm crawler:dev  # Crawler local dev via wrangler dev
```

## Cloudflare deploy

Operator-only. Requires `wrangler` authenticated to the target account.

```sh
# 1. Provision D1, R2, and Vectorize
./scripts/setup.sh

# 2. Copy the database_id printed by setup.sh into apps/crawler/wrangler.toml
#    (replace the REPLACE_ME value in the [[d1_databases]] block)

# 3. Apply the schema migration
./scripts/migrate.sh

# 4. Store the Anthropic API key as a Worker secret
cd apps/crawler && wrangler secret put ANTHROPIC_API_KEY

# 5. Deploy
pnpm crawler:deploy
pnpm --filter @blueport/web deploy
```

> **Browser Rendering** (`[browser]` binding in `apps/crawler/wrangler.toml`) powers the SIAN + Corbell connectors and requires the **Workers Paid plan**. On the free plan the crawler still deploys; the `browser`-kind connectors error per-run and are skipped, while the `fetch`-kind connectors (war.gov, NARA) and the dashboard work normally.

## How it works

- The crawler Worker runs every 6 hours via Cloudflare Cron Triggers and iterates the **connector registry**. Each connector declares its `kind`: `fetch` (static portal → `.pdf` links) or `browser` (rendered with headless Chrome).
- Discovered assets are classified by extension into media types (`pdf`, `image`, `audio`, `video`). PDFs and images are downloaded + hash-anchored to R2 at `docs/<sha256>.<ext>`; audio/video are recorded as link-only (`r2_key` empty). A hostname allowlist per connector guards against SSRF.
- Each downloaded file is SHA-256 fingerprinted. Documents seen before are skipped; new content lands at a new hash. R2 objects are never overwritten.
- PDFs run OCR — text-layer via `unpdf` first; below 50 avg chars/page it falls back to Claude Haiku's PDF vision input (parse `<page n="X">…</page>` output) — then Claude Haiku extracts title, doc type, dates, a factual summary, and up to 30 named entities.
- **Released vs. withheld**: every document has a `status`. Items known to exist but not released (e.g. a UAP video named in a congressional request) are recorded as `referenced_withheld` with no stored original — surfaced as a counter on the dashboard. Seed entries require a verifiable public reference; filenames are never fabricated.
- Per-source crawl runs are tracked in `crawl_runs` (with `source_id`), and the `/activity` dashboard aggregates documents by source, country, and day.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start the Astro web dev server on :4321 |
| `pnpm build` | Production build of the Astro frontend |
| `pnpm crawler:dev` | Run the crawler Worker locally via wrangler dev |
| `pnpm crawler:deploy` | Deploy the crawler Worker to Cloudflare |
| `pnpm typecheck` | TypeScript typecheck across all packages |
| `pnpm db:generate` | Regenerate Drizzle migration files from schema |
| `pnpm db:migrate` | Run Drizzle migrations (local dev) |
| `scripts/setup.sh` | One-time provisioning of D1, R2, and Vectorize |
| `scripts/migrate.sh` | Apply all `drizzle/*.sql` migrations in order to D1 (`--local` or `--remote`) |

## Roadmap

See [tasks/todo.md](tasks/todo.md) for the full plan with acceptance criteria. Phases at a glance:

- **v0.1 — MVP**: crawl + OCR + FTS5 search + RSS + provenance
- **v0.2 — Distribution polish**: email digest, X auto-thread, Voyage-3 embeddings, vector search, saved searches
- **v0.3 — Incident graph**: geocoded entity map, scrubbable timeline, cross-source linking
- **v0.4 — Redaction intelligence**: CV-detected redaction bars, redaction type classification, FOIA archaeology across releases, contradiction view
- **v0.5+ — Backlog**: multimedia transcription, AI assistant, community annotations, developer platform, international expansion

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: changes shipped as a service must be open-sourced under AGPL-3.0. New behavior needs a test. Every claim in the data layer must cite a source page.

## License

[AGPL-3.0-only](LICENSE). The ingestion pipeline is open-source by design — trust requires auditability.

## Why this exists

The Pentagon began publishing UFO files. Whoever owns the searchable, source-grounded index of those documents owns every journalist, researcher, and curious citizen who ever wants to verify a claim. Blueport is that index: hash-anchored, page-cited, no editorial framing, open pipeline.
