#!/usr/bin/env bash
set -euo pipefail
pnpm --filter @agentOS/sdk build
pnpm --filter @agentOS/sdk publish --access public --no-git-checks
