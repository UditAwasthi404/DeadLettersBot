#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then echo "Usage: scripts/backup.sh OUTPUT_DIR" >&2; exit 2; fi
OUT_DIR=$1
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "AWS CLI v2 is required" >&2; exit 1; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$OUT_DIR/agentos-$STAMP"
mkdir -p "$DEST"
pg_dump --format=custom --no-owner --file="$DEST/postgres.dump" "$DATABASE_URL"
export AWS_ACCESS_KEY_ID=$S3_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$S3_SECRET_KEY AWS_DEFAULT_REGION=${S3_REGION:-us-east-1}
for BUCKET in conversation-blobs summary-archives; do
  aws --endpoint-url "$S3_ENDPOINT" s3 sync "s3://$BUCKET" "$DEST/$BUCKET"
done
printf '%s\n' "$DEST"
