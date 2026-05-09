# Contributing

Blueport is an open audit-trail for government-released UAP/UFO documents. The most valuable contributions are those that improve accuracy, extend coverage to additional sources, or strengthen the provenance chain. If a change makes it harder to verify where a claim came from, it will not merge.

## Local dev

```sh
pnpm install
pnpm dev          # Astro web dev server on :4321
pnpm crawler:dev  # Crawler Worker locally via wrangler dev
```

The crawler requires an Anthropic API key to run OCR fallback and entity extraction locally. Copy the example vars file and fill in the key:

```sh
cp apps/crawler/.dev.vars.example apps/crawler/.dev.vars
# Set ANTHROPIC_API_KEY in apps/crawler/.dev.vars
```

To apply the D1 schema to the local dev database:

```sh
./scripts/migrate.sh --local
```

A `scripts/seed.sh` script for populating test data is planned for v0.2. Until then, trigger a local crawl via the `POST /admin/crawl` endpoint on the running crawler Worker (authenticated with the `ANTHROPIC_API_KEY` value from `.dev.vars`).

## Branches

- Feature branches: `feat/<slug>`
- Bug fixes: `fix/<slug>`
- Never push directly to `main`. All changes go through a PR.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(crawler): add dedup by SHA256 on ingest
fix(web): handle missing document date in doc page
chore(infra): bump wrangler to 3.x
docs(readme): update setup instructions
refactor(db): extract sha256 helper into utils
test(extract): add entity extraction unit tests
```

Scope examples: `crawler`, `web`, `db`, `infra`.

## Pull requests

- Reference an entry in [tasks/todo.md](tasks/todo.md) or `CHANGELOG.md` in the PR description.
- CI must pass: `pnpm typecheck` and `pnpm build` must exit 0.
- Squash-merge is the default. Keep your branch history clean, but the squash commit is what lands.

## Tests

Tests run with [vitest](https://vitest.dev/). New behavior requires a test before a PR merges. Cover edge cases: empty document text, OCR returning zero pages, Claude returning malformed JSON, R2 write failures, hash collisions (should not be possible, but verify the dedup path).

UX flows (search, doc page rendering, RSS validation) are tested by hand against `pnpm dev` until Playwright is wired in v0.3.

```sh
pnpm test          # run vitest across all packages
pnpm typecheck     # TypeScript strict check
```

## Adding a source

Blueport is designed to be multi-source. The v0.1 implementation crawls war.gov only, but the connector contract is forward-compatible. A new source connector will implement two functions against a common interface that will be formalized in `apps/crawler/src/crawl.ts` in v0.2:

```ts
// Fetch the index page and return an array of document URLs.
fetchIndex(): Promise<string[]>

// Fetch a single document and return its raw bytes.
fetchDoc(url: string): Promise<ArrayBuffer>
```

If you want to wire a new source ahead of that interface landing, open an issue first. The priority order for next sources is AARO, congressional hearing transcripts, and the UK MoD disclosure archive.

## License and DCO

Blueport is licensed [AGPL-3.0-only](LICENSE). By contributing, you license your work under AGPL-3.0. This means any service that ships your changes must publish its full source under AGPL-3.0.

No CLA is required for v0.1. We will revisit at v1.0 if contributor volume warrants it.

## Code of conduct

Keep discussion focused on the documents and the code. No harassment. No conspiracy framing in the data layer — `summary`, `entities`, and all extracted fields must be factual and source-grounded. Source citations are non-negotiable: every claim must point to a specific page of a specific document in the archive. Editorial speculation belongs in issue comments, not in merged code.
