#!/usr/bin/env bash
set -euo pipefail
VERSION=$1
if [ -z "${VERSION:-}" ]; then
  echo "usage: release.sh <version>"
  exit 1
fi

pnpm typecheck
pnpm lint
pnpm test

pnpm --filter @agentOS/sdk build
if [ -n "${NPM_TOKEN:-}" ]; then
  pnpm --filter @agentOS/sdk publish --access public --no-git-checks
fi

if [ -n "${CSC_LINK:-}" ] || [ -n "${CSC_NAME:-}" ]; then
  pnpm --filter @agentOS/desktop exec electron-builder --mac --win --publish never
fi

if [ -f CHANGELOG.md ]; then
  gh release create "v$VERSION" --title "AgentOS v$VERSION" --notes-file CHANGELOG.md
fi

if [ -n "${DOCKER_TOKEN:-}" ]; then
  echo "$DOCKER_TOKEN" | docker login --username "${DOCKER_USERNAME:-agentos}" --password-stdin
  docker build -f infra/docker/Dockerfile.host -t "agentos/box-host:$VERSION" .
  docker push "agentos/box-host:$VERSION"
fi

echo "Release $VERSION complete."
