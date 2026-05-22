# UAP/UFO Source Catalog — scrape targets

Research findings: where the government UAP databases live, and which GitHub
repos mirror/clean/aggregate them so we can ingest without fighting anti-bot
walls. Compiled 2026-05-22.

> **"ouora.gov" does not exist.** The real federal UAP databases are below.
> It's most likely a voice-to-text garble of one of them (war.gov / AARO / NARA).

## 1. Federal sources of truth (the originals)

| Site | What | Scrapable directly? |
|---|---|---|
| **war.gov/ufo** (PURSUE) | The May 2026 multi-agency release (FBI, NASA, AARO, DoW, State, INDOPACOM, USAF) | ❌ **Hard 403 + JS-only shell.** Not scrapable. Use a GitHub mirror. |
| **aaro.mil/UAP-Records** | DoD AARO reports, trends, imagery | ❌ Direct fetch 403s. ✅ via **Wayback CDX** (already wired: `us-aaro`, 144 PDFs available) |
| **archives.gov** (NARA, Record Group 615) | NDAA-mandated UAP Records Collection | ⚠️ Catalog system, not direct PDFs. Needs NARA Catalog API. |
| **energy.gov/nnsa** (DOE) | DOE/NNSA UAP resources | ⚠️ Few docs; check Wayback. |

## 2. GitHub: PURSUE full mirrors (original PDFs/video)

| Repo | ⭐ | Contents | Format | Route |
|---|---|---|---|---|
| **`ckpxgfnksd-max/uap-release-01`** | 88 | Full war.gov PURSUE mirror — 132 files / 2.4 GB (118 PDF, 28 MP4, 8 PNG, 6 JPG) | PDFs via **Git LFS** | raw + LFS, or `git lfs` clone |
| **`vfp2/pursue-ufo-files`** | — | Downloads all 119 PDFs (~8–10 GB) + index/analyze tooling | PDF + scripts | run their downloader |
| **`vng9trmgr8-pixel/war-gov-ufo-release-1`** | 10 | Mirror of Release 01 with summaries | PDF + summaries | raw |
| **`pursue-uap-project/pursueproject`** | 1 | Searchable bilingual archive, 119+ docs as page scans | JPG/PNG + stories.json | raw |

## 3. GitHub: cleaned / machine-readable datasets ← **best for ingest**

| Repo | ⭐ | Contents | Format | Status |
|---|---|---|---|---|
| **`Pump-OS/alien-files`** | — | OCR-indexed PURSUE mirror, 161 records (DoW 82, FBI 56, NASA 15, State 8) | `index.json` + `fulltext.json` | ✅ **INGESTED** (`pursue-archive`, 161 docs) |
| **`AlexZhangji/ufo-pursue-open-atlas`** | 13 | "Clean, machine-readable open dataset + interactive atlas" of PURSUE | dataset + atlas | 🔎 worth ingesting; verify schema |
| **`timfaner/wtf-ufo`** | 4 | Reproducible extraction: OCR, cleaned text, **RAG chunks, knowledge graph** | text + graph | 🔎 great for facts/validity layer |

## 4. GitHub: civilian sightings databases (for the map)

| Repo | ⭐ | Contents | Status |
|---|---|---|---|
| **`planetsig/ufo-reports`** | 145 | NUFORC, 80,332 geolocated + time-standardized reports | ✅ **INGESTED** → `/map` |
| `timothyrenner/nuforc_sightings_data` | 43 | NUFORC scraper + processed data | alt/refresh source |
| `mhdSid/uap-monitor` | 3 | Real-time aggregator (NUFORC + intl) **with credibility scoring** | 🔎 for validity layer |

## 5. GitHub: analysis & curation tools ← **for "which docs are valid"**

| Repo | ⭐ | What it does |
|---|---|---|
| **`ckpxgfnksd-max/uap-release-analyzer`** | 150 | Claude skill: turns PURSUE/FBI-Vault/NARA/AARO tranches into a structured 11-section REPORT.md (inventory + text extraction + entity surfacing) |
| **`wretcher207/the-ufo-files`** | — | Curated, **sourced** read of PURSUE 01 + FBI 62-HQ-83894; master reports, 60+ per-case writeups, full OCR transcripts |
| `napalm911/public-ufo-uap-evidence-archive` | — | Cross-source provenance index (AARO/Congress/Disclosure Act) + downloaders |

## What Blueport has ingested so far

- **169 documents**: `pursue-archive` (161, via alien-files) + `us-aaro` (8, via Wayback) → [/activity](https://blueport-dzd.pages.dev/activity)
- **80,332 sightings** (NUFORC) → [/map](https://blueport-dzd.pages.dev/map)

## Recommended next scrape targets

1. **`AlexZhangji/ufo-pursue-open-atlas`** — cleanest structured PURSUE dataset; cross-check/dedupe against alien-files for fuller metadata.
2. **`ckpxgfnksd-max/uap-release-01`** — pull the **original PDFs + 28 videos** (LFS) to get media + hash-anchored originals (we currently only have the mirror's OCR text).
3. **`timfaner/wtf-ufo` / `wretcher207/the-ufo-files`** — borrow their per-case curation + knowledge-graph to build the **document validity/credibility layer** (agency authority + redaction + cross-source corroboration + civilian-sighting match).

## Notes
- All underlying documents are **US-government works = public domain**; repo licenses still matter for any *code/derived-dataset* we vendor — check each before reuse.
- The ecosystem is organized around **PURSUE** (which already bundles FBI/NASA/AARO/DoW/State), so there are few standalone NARA/FBI-only repos — the multi-agency mirrors are the efficient targets.
