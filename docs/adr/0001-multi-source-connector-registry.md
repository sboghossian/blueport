# ADR-0001: Multi-source connector registry with a hybrid fetch/browser runtime

- Status: Accepted
- Date: 2026-05-22

## Context

Blueport v0.1 had a single hardcoded crawler: it read one `SOURCE_INDEX_URL`
(war.gov), parsed `.pdf` links from one static HTML page, restricted them to one
`ALLOWED_SOURCE_HOSTS` value, and even hardcoded `sourceDomain: "war.gov"`.

In May 2026 several new UAP/UFO releases landed at once:

- **war.gov** published a rolling *second release* (PURSUE) — same static portal.
- **US National Archives** (archives.gov) aggregates UAP records — another static portal.
- **Brazil's Arquivo Nacional (SIAN)** opened ~893 sightings — a JS-driven,
  account-gated archive application.
- **Jeremy Corbell / *Sleeping Dog*** surfaced a leak set spread across a film
  and articles, including UAP videos named to Congress but not released.

These sources do not share one ingestion shape. war.gov and NARA fit the existing
"static HTML → `.pdf` links" path. SIAN and Corbell need a real browser (JS
execution, possibly a session) that a fetch-only Worker cannot provide.

## Decision

Introduce a **connector registry** ([`packages/db/src/connectors.ts`](../../packages/db/src/connectors.ts))
shared by the crawler (behavior) and web app (labels/colors). Each connector
declares `id`, `label`, `country`, `kind` (`fetch` | `browser`), `startUrls`,
`allowedHosts`, and optional `seedReferenced`.

`runCrawl` iterates the registry. Two runtimes sit behind the one interface:

- **`fetch`**: the proven v0.1 path — `fetch()` static HTML, `extractPdfUrls`,
  per-connector SSRF host allowlist. Used for war.gov + NARA.
- **`browser`**: **Cloudflare Browser Rendering** (`@cloudflare/puppeteer`,
  `[browser]` binding) renders each start URL and `assets.ts` harvests asset
  links with the same host + extension rules. Used for SIAN + Corbell. The
  browser module is dynamically imported so the fetch path and unit tests never
  load the Workers-only puppeteer dependency.

Adding a new government release is a single registry entry.

## Consequences

- **Positive**: one mental model and one schema for all sources; the fetch path
  is untouched (minimal blast radius); browser rendering stays in-stack; the web
  app gets stable source labels/colors for free.
- **Negative / costs**: Browser Rendering requires the **Workers Paid plan**; on
  the free plan `browser`-kind connectors error per-run and are skipped while
  fetch connectors + the dashboard keep working. Browser scraping of SIAN/Corbell
  is inherently brittle and the `startUrls`/DOM entry points are best-known, not
  yet end-to-end DOM-verified — the generic asset harvester degrades gracefully,
  but first-run output should be reviewed.
- **Guardrail**: `seedReferenced` items must carry a verifiable public
  `sourceUrl` (enforced by a registry test) — Blueport never fabricates filenames.

## Alternatives considered

- **Curated manifest per source** (a JSON list of known doc URLs): more robust,
  no login bots, no ToS risk — but the operator chose full auto-scrape.
- **Firecrawl / external scraper** pushing into D1: strongest extraction, but an
  external dependency and out-of-stack. Kept as a fallback if Browser Rendering
  proves insufficient.
- **Route everything through Browser Rendering**: one code path, but rewrites the
  working static path and burns browser quota for sources that don't need it.
