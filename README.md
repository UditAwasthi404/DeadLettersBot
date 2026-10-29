# AgentOS

AgentOS is a self-hostable, multi-bot agent runtime. It combines a TypeScript monorepo, a WebSocket turn gateway, provider adapters, a Docker-backed browser VM, scoped memory, approvals, peer messages, skills, and routines.

> **Project status:** implementation is in progress. Core host, PostgreSQL and Redis persistence, account bootstrap, scoped memory and memory tools, peer messaging, approvals, skill/routine APIs, cron/webhook triggers, Gmail/Calendar/initial Drive OAuth connectors, initial MCP support, and a desktop chat/memory shell are present. Outbound signed webhooks have a durable retry queue and delivery history. Secure handoff, local PC execution, full subagent lifecycle, runtime compaction acceptance, Microsoft/Salesforce connectors, routine connector/file triggers, production deployment hardening, and launch artifacts remain incomplete.

## Local self-host quickstart

Requirements: Docker Engine with Compose, and a machine able to build the VM image.

```sh
cp .env.example .env
```

Change `JWT_SECRET` in `.env` to a long random value. Keep `INFERENCE_MOCK=1` for local protocol work, or set `INFERENCE_MOCK=0` and provide an inference API key.

```sh
docker compose --project-directory . -f infra/docker/docker-compose.yml up --build
```

The gateway listens on `http://localhost:8787`. Bootstrap the first account once:

```sh
curl -X POST http://localhost:8787/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","displayName":"Admin"}'
```

Save the returned token. The bootstrap route closes automatically after the first account is created. Create bots and manage memory, skills, and routines through the authenticated `/v1` API. The WebSocket endpoint is `/ws` and uses the same bearer token.

Stop the stack with `Ctrl+C`; persistent PostgreSQL and MinIO data remain in Compose volumes.

## Workspace

- `packages/box-host` — HTTP/WebSocket gateway, turn runner, queue worker, API routes.
- `packages/agent-core` — prompt assembly, tool catalog, permissions and dispatch.
- `packages/inference` — OpenAI, Anthropic, Ollama, mock and fallback providers.
- `packages/tools` — browser, web, file, shell and MCP client tools.
- `packages/shared` — protocol types, Drizzle schema, PostgreSQL, Redis and blob storage.
- `packages/memory` — PostgreSQL memory store.
- `packages/routines` — cron expression parser.
- `packages/connectors` — OAuth PKCE, AES-GCM token storage helpers, and Google Gmail/Calendar/Drive actions.
- `packages/desktop` — Electron chat shell with bot list, tool activity, interruption, approvals, and memory viewer/export.
- `packages/sdk` — typed HTTP and gateway client for JavaScript/TypeScript applications.
- `packages/tools/src/mcp.ts` — MCP HTTP JSON-RPC discovery and tool calls.
- Box Host webhook subscriptions — signed turn, routine, and approval event delivery.
- `packages/vm-manager` — Docker and no-op VM managers.
- `docs/` — product, architecture, technical, agent, and phase planning documents.

## Development

Use Node.js 22, pnpm 9.15, and Bun 1.1. Install dependencies with `pnpm install`, then run `pnpm typecheck` and `pnpm lint`. `pnpm dev` starts package development scripts; infrastructure services are in `infra/docker/docker-compose.yml`.

See [Self Hosting](docs/SELF_HOSTING.md), the [Build Plan](docs/BUILD_PLAN.md), and the [Project Status](docs/PROJECT_STATUS.md) for setup notes and remaining work.
Set `METRICS_ENABLED=1` to expose HTTP, turn, inference, step, tool, memory-extraction, and checkpoint latency metrics at `/metrics`. Enable the optional local dashboards with `GRAFANA_ADMIN_PASSWORD=...` and `docker compose --profile observability ...`; restrict metrics access to a trusted network.
