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

## Setting up connectors

Connectors are optional. The gateway still runs without them. Gmail, Google Calendar, Google Drive, OneDrive, Outlook, Teams, SharePoint, and Salesforce all use the same callback URL. The desktop Connect button opens that provider, and the provider sends the browser back to the gateway.

Compose publishes the gateway on **127.0.0.1 port 8787** only. On Windows, `localhost` can resolve to an IPv6 address that does not reach that binding, so the OAuth browser returns to a page that never loads. Use this redirect URI exactly, in the provider console and in `.env`:

`http://127.0.0.1:8787/v1/connectors/oauth/callback`

In the desktop app, set the gateway to `http://127.0.0.1:8787` as well. Do not wrap `.env` values in quotes, and do not leave a space at the end of a line. A trailing space or Windows carriage return is enough to make Google or Microsoft reject the client, or to make token encryption fail after consent.

From PowerShell, after you edit `.env`, recreate the gateway so it sees the new values:

```powershell
Set-Location D:\CODE\DeadLettersBot
docker compose --project-directory . -f infra/docker/docker-compose.yml up -d --build
```

`CONNECTOR_ENCRYPTION_KEY` in `.env.example` is an all-zero development key. It is enough on this PC. Replace it before any real account data leaves the machine. Generate one with:

```powershell
-join ((1..32 | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) }))
```

### Google (Gmail, Calendar, Drive)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable the **Gmail API**, **Google Calendar API**, and **Google Drive API**.
3. Configure the OAuth consent screen as **External**. Add your Gmail address as a test user. Add these scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/drive`
4. Create an OAuth client ID of type **Web application**. Under **Authorized redirect URIs**, add `http://127.0.0.1:8787/v1/connectors/oauth/callback`. Do not add a trailing slash.
5. Put the client ID in `GOOGLE_OAUTH_CLIENT_ID` and the client secret in `GOOGLE_OAUTH_CLIENT_SECRET`.

Gmail, Calendar, and Drive are separate Connect buttons. Each one asks Google for only that product's scopes, and each stores its own token.

### Microsoft (OneDrive, Outlook, Teams, SharePoint)

1. Open [Azure App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and choose **New registration**.
2. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Platform: **Web**. Redirect URI: `http://127.0.0.1:8787/v1/connectors/oauth/callback`. A SPA platform will not work with the client secret.
4. Create a client secret under **Certificates & secrets**. Put the application (client) ID in `MICROSOFT_OAUTH_CLIENT_ID` and the secret value in `MICROSOFT_OAUTH_CLIENT_SECRET`.
5. Under **API permissions**, add these Microsoft Graph **delegated** permissions: `offline_access`, `User.Read`, `Files.ReadWrite`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`.

One Connect action signs in once and covers OneDrive, Outlook Mail, and Outlook Calendar. Personal Microsoft accounts reject Teams and SharePoint scopes, and Microsoft then cancels the entire login, including OneDrive. Leave `MICROSOFT_OAUTH_EXTRA_SCOPES` empty unless the account is a work account and an admin has granted:

`Team.ReadBasic.All` `Channel.ReadBasic.All` `ChannelMessage.Read.All` `ChannelMessage.Send` `Sites.ReadWrite.All`

### Salesforce

Create a connected app, enable OAuth, turn on **Require Proof Key for Code Exchange (PKCE)**, and set the callback to the same `http://127.0.0.1:8787/v1/connectors/oauth/callback` URL. Scopes: `api` and `refresh_token`. Put the consumer key and secret in `SALESFORCE_OAUTH_CLIENT_ID` and `SALESFORCE_OAUTH_CLIENT_SECRET`.

### Use a connector

Restart Compose with the command above. In the desktop app, open **Connectors** and choose **Connect**. Approve the action when a bot calls `ConnectorCall`; sending mail, changing a calendar, and writing files ask for approval. A normal Drive upload may use `text/plain` or `text/plain; charset=utf-8`. Both are accepted.

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
