#!/usr/bin/env bash
set -euo pipefail
pnpm --filter @agentos/sdk build
pnpm --filter @agentos/sdk publish --access public --no-git-checks
