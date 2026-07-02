#!/usr/bin/env bash
set -euo pipefail

MIGRATION_NAME="${1:-schema}"

npx drizzle-kit generate --name "$MIGRATION_NAME"
