#!/usr/bin/env bash
# Apply the Blueport D1 schema migration.
# Defaults to --remote (production). Pass --local to apply against the
# local dev D1 instance used by `wrangler dev`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRAWLER_DIR="${REPO_ROOT}/apps/crawler"
MIGRATION_FILE="${REPO_ROOT}/packages/db/drizzle/0000_init.sql"
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

if [ ! -f "${MIGRATION_FILE}" ]; then
  printf 'error: migration file not found: %s\n' "${MIGRATION_FILE}" >&2
  exit 1
fi

if ! command -v wrangler >/dev/null 2>&1; then
  printf 'error: wrangler not found in PATH\n' >&2
  exit 1
fi

printf '==> Applying %s to D1 %s (%s)\n' "${MIGRATION_FILE#"${REPO_ROOT}/"}" "${D1_NAME}" "${TARGET_LABEL}"

# Run from apps/crawler so wrangler picks up its wrangler.toml binding for DB.
cd "${CRAWLER_DIR}"
wrangler d1 execute "${D1_NAME}" "${TARGET_FLAG}" --file="${MIGRATION_FILE}"

printf '✓ Migration applied (%s)\n' "${TARGET_LABEL}"
