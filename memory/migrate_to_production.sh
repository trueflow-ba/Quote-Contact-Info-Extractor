#!/bin/bash
# ============================================================================
# Preview → Production Mongo migration
# Usage:
#   1. Deploy the app to Emergent production.
#   2. Get the production MONGO_URL (it will be in the production pod's env).
#   3. Export it locally:
#        export PROD_MONGO_URL="mongodb+srv://..."
#        export PROD_DB_NAME="..."   # usually "test_database" or similar
#   4. Run this script:
#        bash /app/memory/migrate_to_production.sh
#
# Notes:
#   - This DROPS each collection in production before restoring (--drop)
#     so the restore is a clean replace, not a merge.
#   - Backup snapshot is at /app/memory/mongo_backup/test_database
# ============================================================================
set -euo pipefail

if [ -z "${PROD_MONGO_URL:-}" ] || [ -z "${PROD_DB_NAME:-}" ]; then
  echo "ERROR: Set PROD_MONGO_URL and PROD_DB_NAME first." >&2
  echo "  export PROD_MONGO_URL='mongodb+srv://...'" >&2
  echo "  export PROD_DB_NAME='test_database'" >&2
  exit 1
fi

BACKUP_DIR="/app/memory/mongo_backup/test_database"
if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: No backup at $BACKUP_DIR. Re-run mongodump first:" >&2
  echo "  mongodump --uri=mongodb://localhost:27017 --db=test_database --out=/app/memory/mongo_backup" >&2
  exit 1
fi

echo "About to restore into:"
echo "  URL:  $PROD_MONGO_URL"
echo "  DB:   $PROD_DB_NAME"
echo "  From: $BACKUP_DIR"
echo
read -r -p "Type YES to continue: " confirm
if [ "$confirm" != "YES" ]; then
  echo "Aborted."
  exit 0
fi

mongorestore --uri="$PROD_MONGO_URL" --nsInclude="${PROD_DB_NAME}.*" \
  --nsFrom="test_database.*" --nsTo="${PROD_DB_NAME}.*" \
  --drop "$BACKUP_DIR/.."

echo
echo "Done. Verify in production by logging in with your existing credentials."
echo "Note: Object storage (PDF files in S3/object store) is NOT migrated."
echo "      The Master Index will show 'Processed' files correctly because"
echo "      contact rows transferred. But re-extracting old runs will fail"
echo "      if the original PDFs aren't reachable from the production pod."
