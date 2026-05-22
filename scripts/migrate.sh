#!/usr/bin/env bash
# Apply the Blueport D1 schema migration.
# Defaults to --remote (production). Pass --local to apply against the
# local dev D1 instance used by `wrangler dev`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRAWLER_DIR="${REPO_ROOT}/apps/crawler"
MIGRATION_DIR="${REPO_ROOT}/packages/db/drizzle"
D1_NAME="blueport"

TARGET_FLAG="--remote"
TARGET_LABEL="remote (production)"

for arg in "$@"; do
  case "${arg}" in
    --local)
      TARGET_FLAG="--local"
      TARGET_LABEL="local"
      ;;
    --remote)
      TARGET_FLAG="--remote"
      TARGET_LABEL="remote (production)"
      ;;
    -h|--help)
      cat <<USAGE
Usage: scripts/migrate.sh [--local|--remote]

  --remote   (default) apply to the production D1 database
  --local    apply to the local dev D1 database
USAGE
      exit 0
      ;;
    *)
      printf 'error: unknown argument: %s\n' "${arg}" >&2
      exit 64
      ;;
  esac
done

if [ ! -d "${MIGRATION_DIR}" ]; then
  printf 'error: migration dir not found: %s\n' "${MIGRATION_DIR}" >&2
  exit 1
fi

if ! command -v wrangler >/dev/null 2>&1; then
  printf 'error: wrangler not found in PATH\n' >&2
  exit 1
fi

# Apply every drizzle/*.sql migration in lexical order (0000_, 0001_, …).
# Note: only 0000_init.sql is idempotent; later additive migrations error if
# already applied. Re-run only against a fresh database.
shopt -s nullglob
MIGRATIONS=("${MIGRATION_DIR}"/[0-9]*.sql)
if [ ${#MIGRATIONS[@]} -eq 0 ]; then
  printf 'error: no migration files in %s\n' "${MIGRATION_DIR}" >&2
  exit 1
fi

# Run from apps/crawler so wrangler picks up its wrangler.toml binding for DB.
cd "${CRAWLER_DIR}"
for MIGRATION_FILE in "${MIGRATIONS[@]}"; do
  printf '==> Applying %s to D1 %s (%s)\n' "${MIGRATION_FILE#"${REPO_ROOT}/"}" "${D1_NAME}" "${TARGET_LABEL}"
  wrangler d1 execute "${D1_NAME}" "${TARGET_FLAG}" --file="${MIGRATION_FILE}"
done

printf '✓ Migrations applied (%s)\n' "${TARGET_LABEL}"
