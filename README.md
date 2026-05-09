# Blueport

The source-grounded archive of UAP/UFO documents released by governments.

> Lineage: [Project Blue Book](https://en.wikipedia.org/wiki/Project_Blue_Book), the USAF UAP investigation 1952–1969. The name pivoted from "Bluebook" after every common `bluebook.*` TLD was squatted; Blueport keeps the reference, with port as observation point.

## What this is

Blueport crawls government-released UAP/UFO documents — starting with the Pentagon's 2026 release at [war.gov/UFO/](https://www.war.gov/UFO/) — OCRs them, hash-anchors the originals to R2, runs entity extraction, and exposes the corpus through full-text search, page-anchored deep links, per-document provenance, and an RSS feed that fires on every new or updated document.

Every claim cites a page. No editorial framing. The ingestion pipeline is AGPL-3.0 by design: trust requires an auditable open-source record of how each document entered the archive, what was extracted from it, and whether it has changed since first fetch.

## Status

Pre-alpha. See [tasks/todo.md](tasks/todo.md) for the live plan and acceptance criteria.

## Stack

- **Frontend**: Astro 5 + Tailwind on Cloudflare Pages
- **Backend**: Hono on Cloudflare Workers (cron-driven crawler + API)
- **DB**: Cloudflare D1 (SQLite + FTS5)
- **Vector**: Cloudflare Vectorize (Voyage-3, 768d, cosine — wired in v0.2)
- **Storage**: Cloudflare R2 (PDF originals, hash-anchored at `docs/<sha256>.pdf`)
- **OCR**: hybrid — `unpdf` text-layer first (free/fast), Claude Haiku PDF vision fallback (~$0.001/page) for scanned documents
- **LLM**: Anthropic Claude — Haiku for entity extraction, Sonnet for summaries (v0.2), Opus for contradiction view (v0.4)
- **Embeddings**: Voyage-3 planned (v0.2)
- **License**: [AGPL-3.0-only](LICENSE)

## Repo layout

```
apps/
  web/      Astro frontend on Cloudflare Pages
  crawler/  Worker with cron + Hono — fetches war.gov, hash-anchors to R2,
            OCRs (unpdf + Claude PDF), entity-extracts (Claude Haiku),
            inserts documents/pages/entities into D1
packages/
  db/       Drizzle schema + 0000_init.sql migration
scripts/
  setup.sh    One-time Cloudflare resource provisioning
  migrate.sh  Apply D1 migrations
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

## How it works

- The crawler Worker runs every 6 hours via Cloudflare Cron Triggers, scraping the war.gov/UFO/ index for PDF links.
- Each PDF is fetched and SHA-256 fingerprinted. Documents seen before are skipped; hash changes trigger an update.
- The original PDF is stored in R2 at `docs/<sha256>.pdf` with `sourceUrl` and `fetchedAt` metadata. R2 objects are never overwritten — new content lands at a new hash.
- OCR runs text-layer extraction via `unpdf` first. If average characters per page falls below 50, it falls back to Claude Haiku's PDF vision input (parse `<page n="X">…</page>` tagged output).
- Claude Haiku extracts structured metadata from the full text: title, doc type, document date, incident date, a factual summary, and up to 30 named entities (person, location, unit, craft, sensor, date) with normalized canonical forms.
- All rows are written to D1 in a single ingestion call: one `documents` row, batch `pages` rows (with `has_redactions` flag set on pattern match), batch `entities` rows.

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
| `scripts/migrate.sh` | Apply `0000_init.sql` to D1 (`--local` or `--remote`) |

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
