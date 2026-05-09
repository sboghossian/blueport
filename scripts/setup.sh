#!/usr/bin/env bash
# Blueport one-shot Cloudflare provisioning.
# Creates D1 database, R2 bucket, and Vectorize index.
# Idempotent: detects "already exists" and continues.
#
# Vector dimensions: 768. Chosen for Voyage-3 (768d) — Anthropic's recommended
# embedding family for legal/document corpora. Switch metric to dotproduct if
# we move to OpenAI text-embedding-3-small (1536d) later; cosine is the safe
# default for normalized embeddings.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRAWLER_DIR="${REPO_ROOT}/apps/crawler"

D1_NAME="blueport"
R2_BUCKET="blueport-docs"
VECTORIZE_INDEX="blueport-pages"
VECTORIZE_DIMS=768
VECTORIZE_METRIC="cosine"

# Colors only when stdout is a TTY.
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RESET=""
fi

log()  { printf '%s==>%s %s\n' "${BOLD}" "${RESET}" "$*"; }
ok()   { printf '%s✓%s %s\n'  "${GREEN}" "${RESET}" "$*"; }
warn() { printf '%s!%s %s\n'  "${YELLOW}" "${RESET}" "$*"; }

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'error: required command "%s" not found in PATH\n' "$1" >&2
    exit 1
  fi
}

require wrangler

# Capture both stdout and stderr; return 0 if the command succeeded OR if it
# failed with an "already exists" message (idempotent behavior).
run_idempotent() {
  local label="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    printf '%s\n' "$out"
    ok "${label}: created"
    return 0
  fi
  if printf '%s' "$out" | grep -qiE 'already exists|conflict|duplicate'; then
    warn "${label}: already exists, skipping"
    printf '%s%s%s\n' "${DIM}" "$out" "${RESET}"
    return 0
  fi
  printf '%s\n' "$out" >&2
  return 1
}

cd "${CRAWLER_DIR}"

log "Creating D1 database: ${D1_NAME}"
D1_OUTPUT="$(wrangler d1 create "${D1_NAME}" 2>&1 || true)"
printf '%s\n' "${D1_OUTPUT}"

# Try to extract database_id from a fresh-create output. Wrangler prints
# something like: database_id = "abc-123-..."
DB_ID="$(printf '%s' "${D1_OUTPUT}" | grep -Eo 'database_id = "[^"]+"' | head -n1 | sed -E 's/database_id = "([^"]+)"/\1/' || true)"

if [ -z "${DB_ID}" ]; then
  if printf '%s' "${D1_OUTPUT}" | grep -qiE 'already exists'; then
    warn "D1 database '${D1_NAME}' already exists; fetching id from \`wrangler d1 list\`"
    # JSON output is only on newer wranglers; fall back to text grep.
    if D1_LIST_JSON="$(wrangler d1 list --json 2>/dev/null)"; then
      DB_ID="$(printf '%s' "${D1_LIST_JSON}" | tr ',' '\n' | grep -A1 "\"name\":\"${D1_NAME}\"" | grep -Eo '"uuid":"[^"]+"' | head -n1 | sed -E 's/"uuid":"([^"]+)"/\1/' || true)"
    fi
    if [ -z "${DB_ID}" ]; then
      D1_LIST_TEXT="$(wrangler d1 list 2>&1 || true)"
      DB_ID="$(printf '%s' "${D1_LIST_TEXT}" | awk -v n="${D1_NAME}" '$0 ~ n { for (i=1;i<=NF;i++) if ($i ~ /^[0-9a-f]{8}-[0-9a-f]{4}-/) { print $i; exit } }')"
    fi
  fi
fi

if [ -n "${DB_ID}" ]; then
  ok "D1 database id: ${DB_ID}"
else
  warn "Could not auto-detect D1 database id. Look it up with: wrangler d1 list"
  DB_ID="<paste-from-wrangler-d1-list>"
fi

log "Creating R2 bucket: ${R2_BUCKET}"
run_idempotent "R2 bucket ${R2_BUCKET}" wrangler r2 bucket create "${R2_BUCKET}"

log "Creating Vectorize index: ${VECTORIZE_INDEX} (dims=${VECTORIZE_DIMS}, metric=${VECTORIZE_METRIC})"
run_idempotent "Vectorize index ${VECTORIZE_INDEX}" \
  wrangler vectorize create "${VECTORIZE_INDEX}" \
    --dimensions="${VECTORIZE_DIMS}" \
    --metric="${VECTORIZE_METRIC}"

cat <<EOF

${BOLD}--- Resources provisioned ---${RESET}

Paste this database_id into ${BOLD}apps/crawler/wrangler.toml${RESET} and
${BOLD}apps/web/wrangler.toml${RESET} (replace the existing REPLACE_ME line):

  [[d1_databases]]
  binding = "DB"
  database_name = "${D1_NAME}"
  database_id = "${DB_ID}"

${BOLD}Next steps${RESET}
  1. Update both wrangler.toml files with the database_id above.
  2. Apply the schema:
       ./scripts/migrate.sh                # remote (production)
       ./scripts/migrate.sh --local        # local dev D1
  3. From apps/crawler/ store the Anthropic key:
       cd apps/crawler && wrangler secret put ANTHROPIC_API_KEY
  4. Deploy:
       pnpm crawler:deploy
       pnpm --filter @blueport/web deploy

EOF
