#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${D1_DATABASE_NAME:-job-finder-agent}"
BINDING="${D1_BINDING:-DB}"
LOCATION="${D1_LOCATION:-oc}"
CONFIG="${WRANGLER_CONFIG:-wrangler.toml}"
MIGRATIONS_DIR="${D1_MIGRATIONS_DIR:-drizzle}"

ENV_FILE_ARGS=()
if [[ -f "${WRANGLER_ENV_FILE:-.env}" ]]; then
  ENV_FILE_ARGS=(--env-file "${WRANGLER_ENV_FILE:-.env}")
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" && -f "$CONFIG" ]]; then
  CLOUDFLARE_ACCOUNT_ID="$(
    sed -n 's/^[[:space:]]*account_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG" | head -n 1
  )"
  export CLOUDFLARE_ACCOUNT_ID
fi

if [[ -f "$CONFIG" ]] && grep -qE "^[[:space:]]*binding[[:space:]]*=[[:space:]]*\"${BINDING}\"" "$CONFIG"; then
  echo "D1 binding \"$BINDING\" already exists in $CONFIG. Skipping database creation."
  node scripts/cloudflare/ensure-d1-migrations-dir.mjs "$CONFIG" "$BINDING" "$MIGRATIONS_DIR"
  exit 0
fi

CREATE_OUTPUT=$(
  npx wrangler d1 create "$DB_NAME" \
  --binding "$BINDING" \
  --location "$LOCATION" \
  --update-config \
  --config "$CONFIG" \
  "${ENV_FILE_ARGS[@]}"
)

echo "$CREATE_OUTPUT"

if ! grep -qE "^[[:space:]]*binding[[:space:]]*=[[:space:]]*\"${BINDING}\"" "$CONFIG"; then
  DATABASE_ID="$(printf "%s\n" "$CREATE_OUTPUT" | sed -n 's/^[[:space:]]*database_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' | tail -n 1)"

  if [[ -z "$DATABASE_ID" ]]; then
    echo "Created D1 database, but could not discover database_id from Wrangler output." >&2
    echo "Add the [[d1_databases]] block Wrangler printed above to $CONFIG, then rerun this script." >&2
    exit 1
  fi

  {
    printf "\n[[d1_databases]]\n"
    printf "binding = \"%s\"\n" "$BINDING"
    printf "database_name = \"%s\"\n" "$DB_NAME"
    printf "database_id = \"%s\"\n" "$DATABASE_ID"
  } >> "$CONFIG"
fi

node scripts/cloudflare/ensure-d1-migrations-dir.mjs "$CONFIG" "$BINDING" "$MIGRATIONS_DIR"
