# Self Hosting

## Docker Compose development deployment

Use Docker Engine with Compose v2 on Linux or macOS. On Windows, use Docker Desktop with Linux containers enabled. The host mounts the Docker socket so it can provision browser containers; run it only on a host where you trust the AgentOS account and tool policy.

1. Copy `.env.example` to `.env` and set `JWT_SECRET` to a random secret. For example, `openssl rand -hex 32`.
2. For Grok answers, set `XAI_API_KEY` in that same root `.env`. There is no second env file under `infra/docker`.
3. Start the stack from the repository root:

   ```sh
   docker compose --project-directory . -f infra/docker/docker-compose.yml up --build
   ```

   Compose starts PostgreSQL, Redis, MinIO, builds the browser VM image, runs database migrations, and starts the host. Each account VM uses a dedicated Docker bridge network; the host joins that network for browser and shell operations. A bot's Xvfb and Chromium browser are created on first browser-tool use with a dedicated display, CDP port, and persistent profile.
4. Build the desktop client with `pnpm --filter @agentOS/desktop build`, or run it locally with `pnpm --filter @agentOS/desktop dev` and `pnpm --filter @agentOS/desktop electron` in separate terminals.
5. In the desktop window, enter a name and email and choose Create account. The app calls `POST /v1/auth/bootstrap` once, stores the session, and uses it for `/v1` and the `/ws` gateway. That route closes after the first account exists.

For long-lived integrations, create an API key through `POST /v1/api-keys` and store the returned secret in a password manager. The secret is only shown once. OAuth-backed Google connectors need the Google client ID, client secret, encryption key, and a redirect URI registered in the Google Cloud project. Enable the Gmail, Calendar, and Drive APIs that you plan to use. Google Drive currently requests the broad `drive` scope for list/read/write/share actions; complete Google's OAuth consent and scope verification requirements before using it with real account data. Set `OAUTH_REDIRECT_URI` (or `GOOGLE_OAUTH_REDIRECT_URI`) to the public HTTPS callback when the gateway is not on this PC. Locally that callback is `http://127.0.0.1:8787/v1/connectors/oauth/callback`, which matches the Compose loopback bind. Register that same callback on the Google, Microsoft, and Salesforce apps. Microsoft services share one connection. Personal Microsoft accounts use the OneDrive and Outlook scopes only; set `MICROSOFT_OAUTH_EXTRA_SCOPES` for Teams and SharePoint on a work account. Salesforce stores its instance URL with the encrypted tokens and must allow PKCE. See the README section "Setting up connectors" for the console steps.

To rotate JWT signing keys without interrupting existing sessions, move the old value of `JWT_SECRET` to `JWT_SECRET_PREVIOUS`, set a new random `JWT_SECRET`, and keep the previous key configured for at most the JWT lifetime (24 hours). Remove `JWT_SECRET_PREVIOUS` after that overlap. An admin credential is required for `POST /v1/auth/sessions/revoke`, which invalidates every JWT session for the account by advancing its session version. The caller's current JWT is revoked too; use an authorized `read-write` or `admin` API key with `POST /v1/auth/session` to mint a replacement JWT. API keys are not revoked by this endpoint and can be individually revoked through `/v1/api-keys/{keyId}`.

To rotate the connector encryption key, first deploy the dual-key-capable release everywhere. Set a new random `CONNECTOR_ENCRYPTION_KEY` and the old value as `CONNECTOR_ENCRYPTION_KEY_PREVIOUS` on every host, then call `POST /v1/connectors/rotate-encryption-key` with an admin credential. The endpoint re-encrypts OAuth tokens, MCP auth tokens, and webhook signing secrets for that account in a transaction, leaves concurrently changed rows untouched, and reports whether another pass is needed. Repeat until `complete` is true; only then remove the previous key from every host. Keep the old key available until no process that can still write old-key ciphertext remains.

MCP servers can be added through `POST /v1/connectors/mcp`. AgentOS accepts HTTPS endpoints, rejects IP literals and common private-network hostnames, and does not follow redirects. Hostname DNS results are not pinned to the outbound connection, so this is not a complete network egress boundary; restrict outbound traffic at the host/firewall or use a controlled egress proxy. For a server running on a developer machine, expose it through an authenticated HTTPS tunnel such as Cloudflare Tunnel or ngrok. Treat discovered tool descriptions and call results as untrusted external content. The current connector implements HTTP JSON-RPC discovery and calls; it does not yet implement persistent health polling or other transports.

Outbound signed webhook subscriptions are created at `/v1/webhook-subscriptions`; the signing secret is returned only once and encrypted at rest. Verify `X-AgentOS-Signature` as `sha256=HMAC_SHA256(secret, timestamp + "." + rawRequestBody)` and reject old timestamps using `X-AgentOS-Timestamp`. Delivery rows are persisted before dispatch, retried with bounded exponential backoff (six attempts by default; configurable with `WEBHOOK_MAX_ATTEMPTS`, capped at ten), and can be inspected with `GET /v1/webhook-deliveries`. A failed delivery can be queued again with `POST /v1/webhook-deliveries/{deliveryId}/retry`. Terminal delivery history is pruned after 30 days by default; set `WEBHOOK_DELIVERY_RETENTION_DAYS=0` to disable pruning or choose a value from 1 to 3650.

The example Compose file binds the database, Redis, MinIO console, and raw host ports to loopback for local development. Replace every default password before placing the stack on a network. The bundled setup remains a development deployment and does not include secret rotation or HA configuration.

The host, PostgreSQL, Redis, and MinIO ports bind to loopback by default. To serve the gateway through Caddy over HTTPS, set `AGENTOS_DOMAIN` in `.env` and start Compose with `--profile tls`. For a public domain, point its DNS records to this host and allow inbound TCP 80/443 (and UDP 443 for HTTP/3); Caddy obtains and renews certificates automatically. For local verification, leave the domain as `localhost` and open `https://localhost` (the local Caddy CA may need to be trusted by the client). The raw gateway remains available at `http://localhost:8787` for development. This profile only fronts the gateway; configure firewall rules, secrets, persistent backups, and infrastructure hardening before production use.

To enable local Prometheus and Grafana, set `METRICS_ENABLED=1` and `GRAFANA_ADMIN_PASSWORD` in `.env`, then start Compose with `--profile observability`. Prometheus is at `http://localhost:9090`, Grafana at `http://localhost:3000`, and the Grafana AgentOS dashboards are provisioned automatically. These services bind to loopback. Metrics currently use an in-process Prometheus exporter; OpenTelemetry tracing and VM container health gauges are not implemented yet.

## Configuration

The host validates required store credentials, endpoint formats, secret formats, provider names, ports, resource limits, retry/retention ranges, and feature flags before connecting to services. Production startup rejects short or placeholder JWT keys, an all-zero connector key, and mock inference. Replace both development secrets before any production deployment.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | S3-compatible conversation blob store |
| `JWT_SECRET` | HMAC key for account session tokens |
| `JWT_SECRET_PREVIOUS` | Temporary previous HMAC key during rotation; remove after the 24-hour token overlap |
| `INFERENCE_MOCK` | Use deterministic mock inference (`1`) or configured providers (`0`) |
| `INFERENCE_PROVIDERS` | Provider order: `xai`, `openai`, `anthropic`, `ollama`. Default is `xai` |
| `XAI_API_KEY` | xAI key used for Grok answers (`https://api.x.ai/v1`) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider credentials |
| `OLLAMA_BASE_URL` | Ollama HTTP endpoint |
| `PORT` | Host HTTP and WebSocket port |
| `BOT_STEP_BUDGET` | Maximum model/tool steps per turn |
| `MODEL_CONTEXT_TOKENS` | Model context window used for compaction estimates; valid range 8,000–2,000,000, default 128,000 |
| `MEMORY_SYNTHESIS_ENABLED` | Enable evidence-based memory synthesis worker; defaults to `0` because edits are automatic, and may be enabled after reviewing the security and data-retention behavior |
| `MCP_STRICT_MODE` | Reject MCP servers whose advertised tool names or descriptions match known prompt-injection patterns; defaults to `0` (warning-only) |
| `VM_IDLE_TIMEOUT_MS` | Idle delay before suspending an account VM |
| `VM_MEMORY_BYTES`, `VM_CPU_NANOS`, `VM_PIDS_LIMIT` | Per-account container resource limits; defaults to 2 GiB RAM, 2 CPUs, and 512 processes |
| `CONNECTOR_ENCRYPTION_KEY` | 32-byte hex key used to encrypt OAuth credentials at rest |
| `CONNECTOR_ENCRYPTION_KEY_PREVIOUS` | Temporary previous key while decrypting and rotating existing connector secrets |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth application credentials |
| `GOOGLE_OAUTH_REDIRECT_URI` | Registered OAuth callback URL, shared by Google, Microsoft, and Salesforce |
| `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` | Microsoft identity platform credentials for Outlook, OneDrive, Teams, and SharePoint |
| `SALESFORCE_OAUTH_CLIENT_ID`, `SALESFORCE_OAUTH_CLIENT_SECRET` | Salesforce connected-app credentials |
| `API_RATE_LIMIT_PER_MINUTE` | Fixed-window account API limit; defaults to 120 |
| `WEBHOOK_MAX_ATTEMPTS` | Maximum delivery attempts before a webhook is marked failed; defaults to 6 and is capped at 10 |
| `WEBHOOK_DELIVERY_RETENTION_DAYS` | Age after which terminal webhook history is removed; defaults to 30, and `0` disables pruning |
| `METRICS_ENABLED` | Enable the Prometheus text endpoint at `/metrics`; keep it on a trusted network |

## Backups

Use `scripts/backup.sh` from an environment with `pg_dump` and AWS CLI v2 installed. It writes a timestamped PostgreSQL dump and exports both blob buckets to the requested directory. Keep the backup encrypted and off-host. `scripts/restore.sh` requires the explicit `--confirm` flag because database restore replaces the target database contents.

## Kubernetes and production sizing

An initial [Helm chart](../infra/helm/agentos/README.md) provisions the host, PostgreSQL, Redis, MinIO, PVCs, Secrets, and optional Ingress. It does not support VM automation because current Docker network/browser routing is not Kubernetes-compatible, and it does not include cert-manager, HA, or autoscaling. The optional Compose Caddy profile provides a TLS gateway. PostgreSQL and Redis HA, external object storage configuration, autoscaling, and tested resource sizing are not implemented yet. Also incomplete: VNC secure handoff, local PC execution, full subagent lifecycle, provider conversation compaction acceptance, durable memory extraction and background synthesis acceptance, MCP tunnel health, connector-event routine triggers, Electron auto-update, and production release artifacts. Microsoft and Salesforce connector actions and file-change watches are implemented; live OAuth consent and VM inotify acceptance remain unverified. Rebuild the VM image so it includes `inotify-tools` before relying on file-change routines. Google Drive actions exist in source but OAuth consent and runtime acceptance remain unverified. The Docker Compose configuration is not a complete production security boundary. Do not expose the default ports or secrets to an untrusted network.
