#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ] || [ "$2" != "--confirm" ]; then echo "Usage: scripts/restore.sh BACKUP_DIR --confirm" >&2; exit 2; fi
BACKUP_DIR=$1
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
[ -f "$BACKUP_DIR/postgres.dump" ] || { echo "postgres.dump not found" >&2; exit 1; }
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "AWS CLI v2 is required" >&2; exit 1; }

pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$DATABASE_URL" "$BACKUP_DIR/postgres.dump"
export AWS_ACCESS_KEY_ID=$S3_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$S3_SECRET_KEY AWS_DEFAULT_REGION=${S3_REGION:-us-east-1}
for BUCKET in conversation-blobs summary-archives; do
  [ -d "$BACKUP_DIR/$BUCKET" ] || { echo "Missing $BUCKET backup" >&2; exit 1; }
  aws --endpoint-url "$S3_ENDPOINT" s3 sync "$BACKUP_DIR/$BUCKET" "s3://$BUCKET" --delete
done
