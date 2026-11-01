# AgentOS

AgentOS is a self-hostable, multi-bot agent runtime. It combines a TypeScript monorepo, a WebSocket turn gateway, provider adapters, a Docker-backed browser VM, scoped memory, approvals, peer messages, skills, and routines.

> **Project status:** implementation is in progress. Core host, PostgreSQL and Redis persistence, account bootstrap, scoped memory and memory tools, peer messaging, approvals, skill/routine APIs, cron/webhook/file-change triggers, Google and Microsoft/Salesforce connector actions, browser skill recording, initial MCP support, and an Electron chat shell with session restore are present. Outbound signed webhooks have a durable retry queue and delivery history. Secure handoff, local PC execution, full subagent lifecycle, runtime compaction acceptance, connector-event triggers, production deployment hardening, and launch artifacts remain incomplete.

## Run the app

Requirements: Docker Desktop with Linux containers, Node.js 22, and pnpm 9.15. The first start builds the host and the browser VM image, so it takes several minutes.

From the repository root, copy `.env.example` to `.env`. Set `JWT_SECRET` to a long random value and `XAI_API_KEY` to your xAI key. That root file is the only env file. Compose reads it when the project directory is the repository root.

```sh
cp .env.example .env
```

```powershell
Copy-Item .env.example .env
```

Start PostgreSQL, Redis, MinIO, the VM image, and the gateway:

```sh
docker compose --project-directory . -f infra/docker/docker-compose.yml up -d --build
```

The gateway listens on `http://localhost:8787`. Confirm it is up:

```sh
curl http://localhost:8787/health
```

```powershell
Invoke-RestMethod http://localhost:8787/health
```

The chat UI is the Electron desktop app. Install dependencies, then run these in two terminals:

```sh
pnpm install
pnpm --filter @agentOS/desktop dev
```

```sh
pnpm --filter @agentOS/desktop electron
```

In the app, enter your name and email and choose Create account. That creates the first account on the gateway, signs you in, and keeps the session on this computer. The route closes after the first account exists; a later setup uses **I already have a token**. Use ＋ to create a bot. The same session authorizes the `/v1` API and the `/ws` WebSocket.

After editing `.env`, apply it with the same `docker compose ... up -d` command. Stop the stack with:

```sh
docker compose --project-directory . -f infra/docker/docker-compose.yml down
```

PostgreSQL and MinIO data stay in Compose volumes. See [Self Hosting](docs/SELF_HOSTING.md) for TLS, metrics, connectors, and key rotation.

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
