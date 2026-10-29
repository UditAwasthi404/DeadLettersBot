#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
fi

if grep -q '^JWT_SECRET=dev-secret-change-me$' .env; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl is required to generate JWT_SECRET" >&2
    exit 1
  fi
  SECRET=$(openssl rand -hex 32)
  sed "s/^JWT_SECRET=dev-secret-change-me$/JWT_SECRET=$SECRET/" .env > .env.tmp
  mv .env.tmp .env
fi

if grep -q '^CONNECTOR_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000$' .env; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl is required to generate CONNECTOR_ENCRYPTION_KEY" >&2
    exit 1
  fi
  CONNECTOR_KEY=$(openssl rand -hex 32)
  sed "s/^CONNECTOR_ENCRYPTION_KEY=.*/CONNECTOR_ENCRYPTION_KEY=$CONNECTOR_KEY/" .env > .env.tmp
  mv .env.tmp .env
fi

docker compose --project-directory . -f infra/docker/docker-compose.yml up --build -d
printf '%s\n' "AgentOS started at http://localhost:8787" \
  "Bootstrap the first account with POST /v1/auth/bootstrap."
