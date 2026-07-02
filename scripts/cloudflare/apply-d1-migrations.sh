#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-remote}"
BINDING="${D1_BINDING:-DB}"
CONFIG="${WRANGLER_CONFIG:-wrangler.toml}"

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

case "$TARGET" in
  local)
    TARGET_FLAG="--local"
    ;;
  remote)
    TARGET_FLAG="--remote"
    ;;
  *)
    echo "Usage: $0 [local|remote]" >&2
    exit 2
    ;;
esac

npx wrangler d1 migrations apply "$BINDING" "$TARGET_FLAG" --config "$CONFIG" "${ENV_FILE_ARGS[@]}"
