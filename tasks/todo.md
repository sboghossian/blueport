# Blueport — Plan

**Name**: Blueport (lineage: Project Blue Book, USAF UAP project 1952-1969)
**Working dir**: `~/Documents/Code/blueport/`
**Repo**: public from day one, AGPL 3.0
**Status**: v0.1.0 SHIPPED ✅ (2026-05-09) — github.com/sboghossian/blueport/releases/tag/v0.1.0

## yalla v0.1 acceptance criteria

1. **AC1 — Installs and builds clean**: `pnpm install`, `pnpm typecheck`, and `pnpm build` all exit 0 from a fresh clone.
2. **AC2 — All v0.1 surfaces render**: `/`, `/search?q=...`, `/doc/[sha]`, `/new`, and `/rss.xml` exist as Astro routes, each renders without crashing on empty/missing data, and the search route honors `q` and basic filters.
3. **AC3 — Documented and released**: README updated with setup + architecture + deploy steps, `ARCHITECTURE.md` + `CONTRIBUTING.md` + `CHANGELOG.md` exist, work shipped via PR (not direct main push), and a `v0.1.0` git tag is pushed to GitHub.
**Started**: 2026-05-09

---

## North Star

The canonical, source-grounded archive of UAP/UFO documents released by governments. Every claim cites a page. Every doc is hash-anchored. The diff watcher is the trojan horse; redaction archaeology + incident graph are the moat.

---

## v0.2 — Multi-source expansion + activity dashboard (SHIPPED code 2026-05-22 — branch `feat/multi-source-expansion`)

> Status: built + verified (79 tests pass, typecheck clean, web build + crawler dry-run bundle OK). Pending: live D1 migration apply, deploy, and DOM-verification of SIAN/Corbell start URLs against the live sites.

**Trigger**: New drops landed — war.gov *second release* (PURSUE), Brazil's national archive (SIAN), and Jeremy Corbell's *Sleeping Dog* leak set. Generalize the single war.gov crawler into a multi-source connector registry and ship a release-activity dashboard so we can see what's releasing, when, and from where.

This pulls forward the Phase 1.1 "multi-source connector stub" and Phase 3 "map + cross-source linking + international expansion" work.

### Decisions locked (grill-me, 2026-05-22)

| # | Decision | Choice |
|---|---|---|
| 1 | Sources (4) | war.gov 2nd release · NARA (archives.gov UAP) · Brazil SIAN · Corbell / *Sleeping Dog* |
| 2 | Ingestion fidelity | **Full auto-scrape** for all four (chosen over curated-manifest) |
| 3 | Scrape runtime | **Hybrid** — fetch-only Worker for war.gov + NARA; **Cloudflare Browser Rendering** (`@cloudflare/puppeteer`) for SIAN + Corbell, in the same crawler Worker |
| 4 | Media model | **Generalize `documents`** — add `media_type` + `status`; nullable OCR/page fields |
| 5 | Dashboard | Timeline + **world map** + per-source/country cards + released-vs-withheld counter + merged "what's new" feed |
| 6 | Sequencing | **Everything in one session** |

### Connector registry

Each source = a typed connector `{ id, label, country, kind, startUrl, allowedHosts }`.

| id | label | country | kind | start URL | notes |
|---|---|---|---|---|---|
| `us-war-gov` | DoW war.gov/UFO (PURSUE) | US | `fetch` | war.gov/UFO/ | existing path; pick up rolling 2nd-release additions |
| `us-nara` | US National Archives UAP | US | `fetch` | archives.gov/research/topics/uaps | verify structure at build — may be catalog, not direct PDFs |
| `br-sian` | Brazil Arquivo Nacional (SIAN) | BR | `browser` | SIAN search UI | JS + possibly login; **no auto-register** |
| `corbell-sleeping-dog` | Corbell / Sleeping Dog leaks | US | `browser` | curated start URLs (film site, Medium, his properties) | scattered; mostly `referenced_withheld` + few hard docs |

### Schema migration (`packages/db`)
- [x] `documents`: add `source_id`, `country`, `media_type`, `status` (additive `ADD COLUMN`)
- [x] ~~Make `r2_key`/`http_status` nullable~~ → kept NOT NULL with documented sentinels (ADR-0002: D1 can't safely DROP/rebuild with cascading FKs); `page_count` already nullable
- [x] `crawl_runs`: add `source_id TEXT` so runs are per-connector
- [x] New migration `0001_multisource.sql` + `schema.test.ts` updated + `migrate.sh` applies all migrations
- [x] Backfill existing rows via migration: `source_id='us-war-gov'`, `country='US'`, defaults for media/status

### Crawler (`apps/crawler`)
- [x] `connectors.ts` (in `@blueport/db`): registry + `Connector` type; `runCrawl` iterates registry (no more hardcoded `sourceDomain`)
- [x] `discover()` per kind (fetch keeps `extractPdfUrls` allowlist+`.pdf`; browser harvests assets)
- [x] `browser.ts`: Cloudflare Browser Rendering (`BROWSER`) renders start URLs; `assets.ts` extracts links
- [x] generalized `ingestAsset`: pdf/image → R2 + (pdf) OCR; audio/video → link-only; OCR only on pdf
- [x] `referenced_withheld` ingest path with synthetic sha (seed list empty — no fabricated filenames)
- [x] `wrangler.toml`: `[browser]` binding; single `scheduled` handler iterates connectors
- [x] Identifiable UA, one request at a time on fetch path · ~~explicit 1 req/s + robots.txt~~ (deferred)

### Dashboard (`apps/web`)
- [x] `/activity` route: stacked timeline, per-source cards (released/withheld/this-week/last-fetched), released-vs-withheld + country counters, merged feed
- [x] World map: inline SVG **bubble-map** over country centroids (US + BR lit; expandable). No map lib — lighter than TopoJSON choropleth (ADR rationale in ARCHITECTURE)
- [x] `lib/activity.ts`: aggregate queries (by source, by country, by source×day)

### Tests + docs
- [x] Unit: registry resolves all 4 + host guard + media-type; asset extraction; `syntheticSha`; geo/color helpers; new schema columns (79 tests pass)
- [x] Edge cases: empty html/source, off-host SSRF, malformed/non-asset URLs, non-http protocols
- [x] Update README + ARCHITECTURE + CHANGELOG + `lessons.md` + ADR-0001/0002
- [x] Work on `feat/multi-source-expansion` branch (commit pending)

### Open risks / flags (resolve during build)
1. **Browser Rendering needs Workers Paid plan** + `browser` binding enabled — confirm account is on it before the SIAN/Corbell path can deploy.
2. **SIAN login** — if browsing genuinely requires auth, I will **not** auto-register an account; I'll use public access or credentials you provide. Surfacing before I hardcode anything.
3. **Corbell sources are unstructured** — expect best-effort extraction; likely mostly `referenced_withheld` rows + a handful of hard docs, not a clean corpus.
4. **NARA structure unverified** — may be a catalog UI rather than direct PDFs; if so it flips from `fetch` to `browser` kind.
5. **ToS / politeness** — robots.txt + identifiable UA + rate-limit on every connector; no aggressive crawling of SIAN.

### ADRs to write
- ADR-001: Multi-source connector registry + hybrid fetch/browser runtime
- ADR-002: Generalized media model (`media_type` + `status` incl. `referenced_withheld`)

---

## Phase 0 — Confirmed decisions

| # | Decision | Confirmed |
|---|---|---|
| 1 | Name | **Blueport** ✅ |
| 2 | Hosting | **Cloudflare** (Pages + Workers + D1 + Vectorize + R2) ✅ |
| 3 | Repo visibility | **Public** day one ✅ |
| 4 | License | **AGPL 3.0** ✅ |
| 5 | Frontend | **Astro** + Tailwind + shadcn ✅ |
| 6 | OCR | **Cloudflare Workers AI** (Llama 3.2 Vision) — upgrade to Mistral in v0.2 if quality demands ✅ |
| 7 | LLM | Claude API — Haiku (entity extraction), Sonnet (summaries), Opus (contradiction view + skeptic/analyst) ✅ |
| 8 | Vector DB | **Cloudflare Vectorize** ✅ |
| 9 | Auth (v0.1) | **None** — fully public read; Clerk in v0.2 ✅ |
| 10 | Domain | **blueport.dashable.dev** (subdomain on existing dashable.dev infra; pivoted from "bluebook" — every common bluebook.* TLD was squatted) ✅ |

---

## Tech stack proposal (pending confirmation)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Astro + Tailwind + shadcn | Content-heavy, SSG-friendly, RSS native |
| Backend | Hono on Cloudflare Workers | Edge-native, matches stack |
| DB | Cloudflare D1 (SQLite) | Free tier, FTS5 built in |
| Vector | Cloudflare Vectorize | Edge embeddings, free tier |
| Storage | Cloudflare R2 | PDF originals, hash-anchored |
| Cron | Cloudflare Cron Triggers | Native diff watcher |
| OCR | Cloudflare Workers AI (Llama 3.2 Vision) | Free tier, in-stack; upgrade to Mistral in v0.2 if quality demands |
| LLM | Anthropic Claude API | Haiku/Sonnet/Opus routing |
| Embeddings | Voyage-3 or text-embedding-3-large | Voyage cheaper at scale |
| Auth | (none in v0.1) → Clerk later | Defer |
| Email | Resend | RSS digest, alerts |
| RSS | self-hosted, Astro-generated | No dep |

Estimated v0.1 cost: <$50/mo on light usage.

---

## Phase 1 — MVP (ship in a week)

**Slice**: ingest + OCR + search + diff RSS + provenance badge.

### 1.1 Ingestion (§A)
- [x] Crawler: hit `war.gov/UFO/` index, follow every PDF/doc link
- [ ] Multi-source connectors stub: war.gov only for v0.1, AARO + Black Vault wired but disabled
- [x] File fingerprinting: SHA256 per doc, store in `documents` table
- [x] Provenance ledger: URL + fetch date + hash + http_status + page count
- [x] R2 upload: store original PDF at `r2://docs/<sha256>.pdf`
- [x] Hash-anchored snapshots: never overwrite, version on hash change
- [x] OCR pipeline: hybrid — `unpdf` text-layer first (free), Claude Haiku PDF vision fallback (~$0.001/page) for scans. Workers AI Llama Vision deferred (no PDF rasterization in Workers).
- [x] Cron: every 6 hours via Cloudflare Cron Triggers

### 1.2 Document understanding (§B, minimal)
- [x] Auto-classification: 4 buckets (incident_report / memo / hearing / other)
- [x] Entity extraction (Haiku): people, locations, units, craft, sensors, dates
- [x] Date extraction: incident_date vs document_date
- [x] Basic redaction flag: `pages.has_redactions` set when `[REDACTED]` / black bars detected (full classification deferred to Phase 4)

### 1.3 Search (§C)
- [ ] Hybrid search: D1 FTS5 (BM25) + Vectorize (cosine)
- [ ] Page-anchored deep links: `/doc/<sha>#page=42`
- [ ] Filter UI: date range, doc type only for v0.1
- [ ] Result card: title, date, source, snippet with query highlight

### 1.4 Diff Watcher (§D, lite)
- [ ] On crawl, diff document set vs last snapshot
- [ ] LLM auto-summary per new doc (Sonnet)
- [ ] Skeptic + analyst dual-take generator (Opus, batched)
- [ ] RSS feed at `/rss.xml` — every new doc = item
- [ ] Public "what's new" page at `/new`

### 1.5 Provenance & trust (§L)
- [ ] "Last verified against war.gov on YYYY-MM-DD" badge per doc
- [ ] "View original PDF" link → R2-hosted snapshot
- [ ] Hash visible on every doc page (proof of integrity)
- [ ] Open-source the ingestion repo from day one

### 1.6 Distribution surface (§J, minimal)
- [ ] OG image generator per doc (Workers + Satori)
- [ ] Permalink to specific quote/page
- [ ] Twitter/X auto-poster on new doc (optional, gated by env flag)
- [ ] Newsletter signup form (Resend) — DB only, no send yet

### 1.7 Acceptance criteria for v0.1 ship
- All war.gov/UFO/ docs crawled + OCR'd within 24h of release
- Search returns results <500ms p95
- Every result links to source PDF + page
- RSS feed validates
- 100% of docs have hash-anchored R2 snapshot
- Open-source repo with working `pnpm install && pnpm dev`

---

## Phase 2 — Distribution polish (week 2)

- [ ] Email digest via Resend (daily / weekly toggle)
- [ ] X auto-thread for top doc of the day (image + summary + link)
- [ ] Substack publisher (REST integration)
- [ ] Saved searches (requires Clerk)
- [ ] Per-user alert filters
- [ ] TTS-narrated podcast feed (ElevenLabs)
- [ ] Embeddable widget for journalists

---

## Phase 3 — Incident Graph (§E, weeks 3-4)

- [ ] Geocode locations from extracted entities → lat/long
- [ ] Map view (Mapbox GL): every geolocated incident pinned
- [ ] Scrubbable timeline (D3 or custom)
- [ ] Knowledge graph schema: incident ↔ witness ↔ unit ↔ craft ↔ sensor
- [ ] Cross-source linking: same event in war.gov + AARO + congressional
- [ ] Curated narrative threads: Nimitz, Roosevelt, Eglin, Tehran, Rendlesham
- [ ] Contradiction view: where the new release conflicts with prior accounts

---

## Phase 4 — Redaction Intelligence (§F, the moat)

- [ ] Redaction detector: CV pass for black bars + classification stamps
- [ ] Redaction-type classifier (Sonnet): name / location / capability / source-method
- [ ] FOIA archaeology: same passage across releases, surface unredacted version where it exists
- [ ] Redaction drift: this got *more* redacted between 2022 and 2026
- [ ] "Behind the bars" view powered by overlap

---

## Phase 5+ — Backlog

- [ ] Multimedia (§G): video transcription, CLIP image search
- [ ] AI assistant (§H): RAG chat, mode toggles, briefing generator
- [ ] Community (§I): annotations, comment threads, verified researcher badges
- [ ] Developer platform (§K): REST + GraphQL + MCP server
- [ ] International expansion: UK MoD, GEIPAN, KGB Blue Folder
- [ ] Mobile, browser ext, Slack/Discord bots
- [ ] Monetization (§M): Pro tier, Enterprise, journalist seats

---

## Risks

1. **Race condition** — someone ships this in 48 hours. Counter: redaction archaeology + incident graph are 4-week moats; race for the audience first via diff watcher.
2. **OCR quality on scans** — handwritten margin notes + low-res scans degrade extraction. Counter: Mistral OCR > Tesseract; fall back to human flagging for low-confidence pages.
3. **Legal / political** — Pentagon docs are public domain, but framing matters. Counter: rigorously source-grounded, no editorial conspiracy framing, dual-take (skeptic + analyst) by design.
4. **Hosting cost spike** — virality drives PDF traffic to R2. Counter: aggressive Cloudflare cache, public-read R2 with cache headers.
5. **Crawl politeness** — war.gov rate limits. Counter: 1 req/sec, identifiable User-Agent, respect robots.txt, fallback to Wayback Machine.
6. **Misinformation amplification** — skeptic mode exists for a reason. Counter: every claim cites page; no doc summary published without source link.

---

## Next concrete step

Confirm Phase 0 decisions (name + stack), then I bootstrap the repo, register the domain, and ship Phase 1.1 (crawler + OCR) as the first PR.
