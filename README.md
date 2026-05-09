# Blueport

The source-grounded archive of UAP/UFO documents released by governments.

> Lineage: [Project Blue Book](https://en.wikipedia.org/wiki/Project_Blue_Book), the USAF UAP investigation 1952–1969.

## What this is

Every UAP document declassified by the Pentagon (starting with [war.gov/UFO/](https://www.war.gov/UFO/)) — crawled, OCR'd, hash-anchored, full-text + semantic searchable, with page-level citations and provenance. RSS for what's new. Map and timeline for incidents. Redaction archaeology across releases.

Every claim cites a page. No editorial framing. Skeptic and analyst takes side by side.

## Status

Pre-alpha. See [tasks/todo.md](tasks/todo.md) for the live plan.

## Stack

- **Frontend**: Astro + Tailwind on Cloudflare Pages
- **Backend**: Hono on Cloudflare Workers (cron-driven crawler + API)
- **DB**: Cloudflare D1 (SQLite + FTS5)
- **Vector**: Cloudflare Vectorize
- **Storage**: Cloudflare R2 (PDF originals, hash-anchored)
- **OCR**: Cloudflare Workers AI (Llama 3.2 Vision)
- **LLM**: Anthropic Claude (Haiku → entity extraction, Sonnet → summaries, Opus → contradiction view)

## Repo layout

```
apps/
  web/         Astro site on Cloudflare Pages
  crawler/     Worker — cron-driven ingestion + OCR
packages/
  db/          Drizzle schema for D1, shared
tasks/
  todo.md      Plan source of truth
```

## Getting started

```sh
pnpm install
pnpm dev          # web dev server on :4321
pnpm crawler:dev  # crawler local cron via wrangler
```

## License

[AGPL 3.0](LICENSE). The ingestion pipeline is open-source by design — trust requires auditability.

## Why this exists

The Pentagon began publishing UFO files. Whoever owns the searchable, source-grounded index of those documents owns every journalist, researcher, and curious citizen who ever wants to verify a claim. Blueport is that index.
