#!/bin/sh
set -eu
if migration_output="$(npx prisma migrate deploy 2>&1)"; then
  printf '%s\n' "$migration_output"
elif printf '%s' "$migration_output" | grep -q 'P3005'; then
  printf '%s\n' "$migration_output"
  printf '%s\n' 'Existing Alembic schema detected; applying the additive compatibility migration.'
  npx prisma db execute --file prisma/migrations/20260913000000_document_platform/migration.sql --schema prisma/schema.prisma
  npx prisma migrate resolve --applied 20260913000000_document_platform
  npx prisma migrate deploy
else
  printf '%s\n' "$migration_output" >&2
  exit 1
fi
exec node dist/main.js
