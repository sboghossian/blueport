# Lessons — Blueport

Append-only. What was surprising or non-obvious during a yalla run, framed so future-me doesn't repeat the same trap.

## v0.1 ship (2026-05-09)

### Dep version on a dated SDK matters
- `@anthropic-ai/sdk` ^0.32.1 didn't have `document` as a content type, so the OCR fallback failed typecheck even though the API supported PDFs since late 2024. Bumped to ^0.40.0.
- Always cross-check SDK feature matrix vs the pinned version *before* shipping a feature that depends on a newer block type. Cheap and easy to miss.

### Workers can't rasterize PDFs natively
- The Phase 0 plan said "Workers AI (Llama 3.2 Vision) for OCR" — but to feed it images, we'd need to render PDF pages → PNG inside a Worker, and there's no native renderer there.
- Pragmatic pivot: `unpdf` text-layer first, Claude Haiku PDF input as fallback. ~$1–5 to backfill the entire war.gov archive vs setting up a separate raster service.
- Workers AI binding stays in `wrangler.toml` for future multimodal work (image search, etc.).

### gh OAuth lacks `workflow` scope by default
- Default `gh auth login` token has `gist, read:org, repo` — *not* `workflow`. Any commit that creates or modifies `.github/workflows/*` is rejected on push.
- `gh auth refresh -s workflow` requires browser device-code flow, which blocks automated runs.
- Workaround used: stash workflow files outside the repo, soft-reset + amend to drop them from the diff, push, surface the stash path so the operator can add them post-merge via web UI or after refreshing scope.
- Avoid in future: refresh scope *before* the run, or commit workflow files in a separate post-merge step the operator owns.

### D1 multi-step inserts aren't atomic
- Crawler does 3 sequential `db.insert()` calls (documents → pages → entities). If pages or entities fails after documents, the SHA dedup table now permanently locks out that doc with no pages.
- v0.2 fix: wrap in `db.batch([...])`, or compensating delete on failure.

### Astro `Response` from `.astro` frontmatter is fragile
- Returning a bare `new Response(..., { status: 404 })` from inside `---` script of an `.astro` page worked in some adapter versions but not all. Some render blank.
- Cleaner pattern: `Astro.redirect('/not-found')` or render a real 404 component.

### SSRF is the default failure mode for HTML scrapers
- The crawler walks `<a href="*.pdf">` from war.gov HTML. War.gov HTML is third-party input — one injected `<a href="http://169.254.169.254/.../x.pdf">` weaponizes the crawler into IMDS / RFC1918 probes plus a public mirror of arbitrary content.
- Fixed: hostname allowlist (`ALLOWED_SOURCE_HOSTS`, default `war.gov`) applied immediately after `new URL(href, base)`. Non-http(s) protocols also rejected.
- Lesson: any time we resolve URLs from third-party content and then `fetch()` them server-side, validate hostname before the fetch.

### Bearer-token reuse is a high-blast-radius leak
- Initial `/admin/crawl` used `ANTHROPIC_API_KEY` itself as the bearer token. Anyone phishing/leaking that bearer (logs, screen share, browser history, curl in shell history) immediately has billing access to the Anthropic account.
- Fix: separate `CRAWL_ADMIN_TOKEN` secret, constant-time compare.
- Rule: never reuse a third-party paid-API key as an internal auth credential.

### Claude Haiku occasionally fences JSON despite system prompt
- System prompt says "Output ONLY valid JSON, no markdown fence." Haiku still wraps it in ` ```json ` sometimes. Bare `JSON.parse(text)` throws and aborts the entire ingest (R2 already populated → orphan).
- Fix: `stripJsonFence()` helper before parse. Always assume LLM JSON output may be fenced.

### Dev-server smoke tests via background `pnpm dev` are tricky
- Tried to background `pnpm dev`, sleep, then curl. Astro never bound — turned out chained `head -1` consumed stdout and killed the process. All curls returned `status=000`.
- Rebuild + typecheck pass is a strong-enough signal for routes parsing; live dev-server verification needs a proper supervisor (or skip until deploy).

## v0.2 multi-source expansion (2026-05-22)

### D1 migrations can't safely DROP a table with cascading FKs
- Relaxing a NOT NULL column in SQLite needs a table rebuild (create/copy/**drop**/rename). On D1, migrations run inside a transaction, where `PRAGMA foreign_keys=OFF` is a **no-op** — and `DROP TABLE documents` does an implicit DELETE that fires `ON DELETE CASCADE` on `pages`/`entities`, silently wiping them. `PRAGMA defer_foreign_keys` defers *checks*, not cascade *actions*, so it doesn't help.
- Pragmatic fix: keep `r2_key`/`http_status` NOT NULL, use documented sentinels (`""`/`0`), and make the migration purely additive `ADD COLUMN`. If true nullability is ever required, run the rebuild with `foreign_keys=OFF` in a standalone `wrangler d1 execute` *outside* the migration runner. (ADR-0002)

### Verify SDK/package versions before pinning — again
- Pinned `@cloudflare/puppeteer` at `^0.0.14` from memory; npm `latest` is actually `1.1.0` (`0.0.14-rc` only lives under the `next` tag). `npm view <pkg> dist-tags` in five seconds beats a failed install. (Same class of trap as the `@anthropic-ai/sdk` version miss in v0.1.)

### Dynamically import Workers-only deps to keep code unit-testable
- `@cloudflare/puppeteer` is Workers-only and shouldn't load in node/vitest. A static `import` in `crawl.ts` would pull it into every test that imports the crawler. Switched to `await import("./browser.js")` inside the `browser`-kind branch — keeps puppeteer out of the static graph for the fetch path and tests, with zero runtime cost on the path that does use it.

### Parse rendered HTML as a string, not via DOM types in `$$eval`
- Puppeteer's `page.$$eval` callback runs in the browser and needs DOM lib types; adding `"DOM"` to a Workers tsconfig fights `@cloudflare/workers-types` over globals. Used `page.content()` to get post-render HTML, then reused the same regex/string asset parser as the fetch path. No DOM types, one extraction code path, easy to unit-test (`assets.ts` is pure).

