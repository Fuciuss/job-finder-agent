#!/usr/bin/env bash
set -euo pipefail

MIGRATION_NAME="${MIGRATION_NAME:-init}"
APPLY_TARGET="${APPLY_TARGET:-remote}"

if [[ "${SKIP_CREATE:-}" != "1" ]]; then
  bash scripts/cloudflare/create-d1.sh
fi

bash scripts/cloudflare/generate-d1-migration.sh "$MIGRATION_NAME"
bash scripts/cloudflare/apply-d1-migrations.sh "$APPLY_TARGET"
