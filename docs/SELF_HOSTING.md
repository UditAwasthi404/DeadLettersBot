# Self Hosting

## Docker Compose development deployment

Use Docker Engine with Compose v2 on Linux or macOS. On Windows, use Docker Desktop with Linux containers enabled. The host mounts the Docker socket so it can provision browser containers; run it only on a host where you trust the AgentOS account and tool policy.

The Compose network defaults to `agentos`. Set a unique `AGENTOS_NETWORK_NAME` when running multiple AgentOS Compose projects on the same Docker Engine to keep service discovery isolated.

Docker VMs support three outbound policies. `allow_all` is the default. `deny_all` creates internal account networks with no external routing. `allowlist` starts a small per-account egress helper in the account network and joins the VM to its network namespace. Box-host waits for the helper's readiness healthcheck before starting or waking a VM. The helper installs a fail-closed firewall: only configured destination CIDRs or exact domains and TCP/UDP ports are allowed, plus Docker's embedded DNS resolver at `127.0.0.11:53`; wildcard domains are not supported. Rules are limited to 4,096 expanded firewall entries, with at most 64 resolved addresses per domain. Its healthcheck flushes the managed IPv4/IPv6 rules if the supervisor exits or misses a scheduled domain refresh. VM containers and their Docker exec processes receive no network-administration capabilities. Set `VM_EGRESS_ALLOWLIST` to a JSON array such as `'[{"domain":"api.example.com","ports":[{"protocol":"TCP","port":443}]}]'` or use a `cidr` field for static network ranges. Domain answers are resolved through Docker DNS, refreshed according to DNS TTLs (capped at five minutes), and installed only when the address is globally routable; private, loopback, link-local, and reserved answers are rejected. If DNS is unavailable or a domain has no public answer, that domain has no outbound rule. Existing established connections may remain until closed after an address expires. Docker prewarming is unavailable with allowlist mode.

Changing the policy or allowlist does not mutate existing account VMs, helpers, or networks. Terminate and reprovision each account VM to apply a new configuration. In allowlist mode, the small supervisor retains only the capabilities needed to refresh its isolated firewall; its idle child runs as the unprivileged `agent` user. If firewall setup fails, the helper and VM do not start.

The Helm deployment supports `agent.vmEgressPolicy: allowlist` with explicit destination CIDRs and protocol/port pairs. This remains IP-based filtering: include the cluster DNS resolver address and its DNS port if VMs need hostname resolution, and include each destination network/port required by the workload. Kubernetes enforcement requires a CNI that implements NetworkPolicy.

`RunShell` uses Linux Landlock to confine filesystem opens to `/home/agent` and `/tmp` for writes, `/usr` for runtime reads/execution, and `/etc` for read-only configuration. A nested seccomp filter blocks IP sockets, connection/bind, process signaling/tracing, and io_uring for the command. Both filters fail closed. Commands still share the account VM's PID namespace; `VM_EGRESS_POLICY=deny_all` also disables Internet routing for Chromium and other VM processes.

1. Copy `.env.example` to `.env` and set `JWT_SECRET` to a random secret. For example, `openssl rand -hex 32`.
2. For Grok answers, set `XAI_API_KEY` in that same root `.env`. There is no second env file under `infra/docker`.
3. Start the stack from the repository root:

   ```sh
   docker compose --project-directory . -f infra/docker/docker-compose.yml up --build
   ```

   Compose starts PostgreSQL, Redis, MinIO, builds the Ubuntu 22.04 `agentos/vm-manager` image (override with `VM_IMAGE`), runs database migrations, and starts the host. The VM image includes Node.js 22 and npm 10 for workspace scripts, Chromium installed by pinned Playwright 1.64.1, Xvfb, and shell tools. Each account VM uses a dedicated Docker bridge network; the host joins that network for browser and shell operations. A bot's Xvfb and Chromium browser are created on first browser-tool use with a dedicated display, CDP port, and persistent profile.
4. Build the desktop client with `pnpm --filter @agentos/desktop build`, or run it locally with `pnpm --filter @agentos/desktop dev` and `pnpm --filter @agentos/desktop electron` in separate terminals.
5. In the desktop window, enter a name and email and choose Create account. The app calls `POST /v1/auth/bootstrap` once, stores the session, and uses it for `/v1` and the `/ws` gateway. That route closes after the first account exists.

## Kubernetes deployment

The Helm chart selects `VM_BACKEND=kubernetes` and grants box-host namespaced access to VM pods, their `pods/exec` streams, and account PVCs. Each account VM runs as UID 1000 with dropped Linux capabilities, a RuntimeDefault seccomp profile, resource requests/limits, and a persistent home volume. VM NetworkPolicies restrict inbound CDP/VNC ports to box-host. Use a CNI that enforces NetworkPolicies. With `agent.vmEgressPolicy: deny_all`, VM DNS and internet access are blocked; `allow_all` restores outbound access. The chart currently requires one box-host replica until queue ownership moves to Redis. See [the Helm README](../infra/helm/agentos/README.md) for values and limitations.

For long-lived integrations, create an API key through `POST /v1/api-keys` and store the returned secret in a password manager. The secret is only shown once. OAuth-backed Google connectors need the Google client ID, client secret, encryption key, and a redirect URI registered in the Google Cloud project. Enable the Gmail, Calendar, and Drive APIs that you plan to use. Google Drive currently requests the broad `drive` scope for list/read/write/share actions; complete Google's OAuth consent and scope verification requirements before using it with real account data. Set `OAUTH_REDIRECT_URI` (or `GOOGLE_OAUTH_REDIRECT_URI`) to the public HTTPS callback when the gateway is not on this PC. Locally that callback is `http://127.0.0.1:8787/v1/connectors/oauth/callback`, which matches the Compose loopback bind. Register that same callback on the Google, Microsoft, and Salesforce apps. Microsoft services share one connection. Personal Microsoft accounts use the OneDrive and Outlook scopes only; set `MICROSOFT_OAUTH_EXTRA_SCOPES` for Teams and SharePoint on a work account. Salesforce stores its instance URL with the encrypted tokens and must allow PKCE. See the README section "Setting up connectors" for the console steps.

To rotate JWT signing keys without interrupting existing sessions, move the old value of `JWT_SECRET` to `JWT_SECRET_PREVIOUS`, set a new random `JWT_SECRET`, and keep the previous key configured for at most the JWT lifetime (24 hours). Remove `JWT_SECRET_PREVIOUS` after that overlap. An admin credential is required for `POST /v1/auth/sessions/revoke`, which invalidates every JWT session for the account by advancing its session version. The caller's current JWT is revoked too; use an authorized `read-write` or `admin` API key with `POST /v1/auth/session` to mint a replacement JWT. API keys are not revoked by this endpoint and can be individually revoked through `/v1/api-keys/{keyId}`.

To rotate the connector encryption key, first deploy the dual-key-capable release everywhere. Set a new random `CONNECTOR_ENCRYPTION_KEY` and the old value as `CONNECTOR_ENCRYPTION_KEY_PREVIOUS` on every host, then call `POST /v1/connectors/rotate-encryption-key` with an admin credential. The endpoint re-encrypts OAuth tokens, MCP auth tokens, and webhook signing secrets for that account in a transaction, leaves concurrently changed rows untouched, and reports whether another pass is needed. Repeat until `complete` is true; only then remove the previous key from every host. Keep the old key available until no process that can still write old-key ciphertext remains.

MCP servers can be added through `POST /v1/connectors/mcp`. AgentOS accepts HTTPS endpoints, rejects IP literals and common private-network hostnames, and does not follow redirects. Plain HTTP is permitted only for `localhost` and `127.0.0.1` during local development. AgentOS resolves each host before the operation, rejects mixed/private DNS answers, and pins that address for initialization and tool calls. This narrows DNS-rebinding risk but is not a complete network egress boundary; restrict outbound traffic at the host/firewall or use a controlled egress proxy. For a server running on a developer machine, expose it through an authenticated HTTPS tunnel such as Cloudflare Tunnel or ngrok. Treat discovered tool descriptions and call results as untrusted external content. The current connector implements HTTP JSON-RPC discovery and calls. A background health check refreshes each server's status every minute, records generic failure guidance, and probes the configured URL, including tunnel URLs. AgentOS reports endpoint availability but does not launch or supervise external tunnel processes; other MCP transports are not implemented.

Outbound signed webhook subscriptions are created at `/v1/webhook-subscriptions`; the signing secret is returned only once and encrypted at rest. Verify `X-AgentOS-Signature` as `sha256=HMAC_SHA256(secret, timestamp + "." + rawRequestBody)` and reject old timestamps using `X-AgentOS-Timestamp`. Delivery rows are persisted before dispatch, retried with bounded exponential backoff (six attempts by default; configurable with `WEBHOOK_MAX_ATTEMPTS`, capped at ten), and can be inspected with `GET /v1/webhook-deliveries`. A failed delivery can be queued again with `POST /v1/webhook-deliveries/{deliveryId}/retry`. Terminal delivery history is pruned after 30 days by default; set `WEBHOOK_DELIVERY_RETENTION_DAYS=0` to disable pruning or choose a value from 1 to 3650.

The example Compose file binds the database, Redis, MinIO console, and raw host ports to loopback for local development. Replace every default password before placing the stack on a network. The bundled setup remains a development deployment and does not include secret rotation or HA configuration.

The host, PostgreSQL, Redis, and MinIO ports bind to loopback by default. To serve the gateway through Caddy over HTTPS, set `AGENTOS_DOMAIN` in `.env` and start Compose with `--profile tls`. For a public domain, point its DNS records to this host and allow inbound TCP 80/443 (and UDP 443 for HTTP/3); Caddy obtains and renews certificates automatically. For local verification, leave the domain as `localhost` and open `https://localhost` (the local Caddy CA may need to be trusted by the client). The raw gateway remains available at `http://localhost:8787` for development. This profile only fronts the gateway; configure firewall rules, secrets, persistent backups, and infrastructure hardening before production use.

To enable local Prometheus, Grafana, and Jaeger, set `METRICS_ENABLED=1` and `GRAFANA_ADMIN_PASSWORD` in `.env`, then start Compose with `--profile observability`. Prometheus is at `http://localhost:9090`, Grafana at `http://localhost:3000`, and Jaeger at `http://localhost:16686`; the Grafana AgentOS dashboards are provisioned automatically. These services bind to loopback. To export OpenTelemetry traces to local Jaeger, set `OTEL_TRACES_EXPORTER=otlp` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` in `.env` before starting the profile. AgentOS emits request, turn, and tool spans when the exporter is configured. Metrics use the in-process Prometheus exporter, including VM lifecycle counts and aggregate Docker CPU/memory usage.

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
| `RUN_SHELL_TIMEOUT_MS` | Maximum `RunShell` duration; defaults to 120 seconds and accepts 1 second–1 hour |
| `MODEL_CONTEXT_TOKENS` | Model context window used for compaction estimates; valid range 8,000–2,000,000, default 128,000 |
| `MEMORY_SYNTHESIS_ENABLED` | Enable evidence-based memory synthesis worker; defaults to `0` because edits are automatic, and may be enabled after reviewing the security and data-retention behavior |
| `MCP_STRICT_MODE` | Reject MCP servers whose advertised tool names or descriptions match known prompt-injection patterns; defaults to `0` (warning-only) |
| `DYNAMIC_TOOL_OFFLOADING` | Offload MCP tool catalogs from each prompt and expose `GetDynamicTools`/`CallDynamicTool`; defaults to `1`. Set to `0` to use the static `MCPCall` prompt path |
| `VM_BACKEND` | `docker` (default), `kubernetes`, or `noop`; Helm selects `kubernetes` |
| `VM_IDLE_TIMEOUT_MS` | Idle delay before suspending an account VM |
| `VM_PREWARM_POOL_SIZE` | Docker only; keeps 0–20 empty containers running without a network, then assigns a container to one account and attaches that account's network on first use. Default `0` (disabled); each slot is subject to the per-VM memory and CPU limits below |
| `VM_EGRESS_POLICY` | Docker and Kubernetes support `allow_all`, `deny_all`, or `allowlist` |
| `VM_EGRESS_ALLOWLIST` | Docker only; JSON array of `cidr` or `domain` rules with TCP/UDP ports. Domain rules resolve to public addresses and refresh by DNS TTL; Docker DNS is allowed separately. Helm uses CIDR-only `agent.vmEgressAllowlist` |
| `VM_MEMORY_BYTES`, `VM_CPU_NANOS`, `VM_PIDS_LIMIT` | Per-account Docker container limits. Kubernetes sets CPU and memory from the first two; its Pod API has no per-pod PID limit field |
| `VM_IMAGE` | Image used for account VMs; Compose builds `agentos/vm-manager` locally by default |
| `VM_K8S_NAMESPACE`, `VM_K8S_STORAGE_SIZE`, `VM_K8S_STORAGE_CLASS` | Kubernetes namespace and account home-volume configuration |
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
| `OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional OpenTelemetry trace exporter and OTLP/HTTP collector endpoint |
| `OTEL_SERVICE_NAME` | OpenTelemetry resource service name; defaults to `agentos-box-host` |

## Backups

Use `scripts/backup.sh` from an environment with `pg_dump` and AWS CLI v2 installed. It writes a timestamped PostgreSQL dump and exports both blob buckets to the requested directory. Keep the backup encrypted and off-host. `scripts/restore.sh` requires the explicit `--confirm` flag because database restore replaces the target database contents.

## Kubernetes and production sizing

The initial [Helm chart](../infra/helm/agentos/README.md) provisions box-host, PostgreSQL, Redis, MinIO, PVCs, Secrets, an optional Ingress, and Kubernetes account VMs with per-account home volumes and NetworkPolicies. When cert-manager is installed, the chart can optionally create a Certificate for configured ingress hosts using an existing issuer. Optional CPU-based HPA is available when the cluster metrics API is installed. The chart remains a single-region starting point without database/cache HA or fresh-cluster acceptance; NetworkPolicy requires an enforcing CNI. The optional Compose Caddy profile provides a TLS gateway. Tested production resource sizing remains open. Remaining runtime or launch work includes subagent restart/race and token-accounting acceptance, provider conversation compaction and durable memory/synthesis acceptance, and production release artifacts. MCP endpoint probes report tunnel URL availability, but AgentOS does not manage external tunnel processes. Secure handoff and desktop-local execution are implemented but need runtime acceptance. Connector-event polling, Electron auto-update, Microsoft/Salesforce connector actions, and file-change watches are implemented; live OAuth consent and VM inotify acceptance remain unverified. Rebuild the VM image so it includes `inotify-tools` before relying on file-change routines. Google Drive actions exist in source but OAuth consent and runtime acceptance remain unverified. The Docker Compose configuration is not a complete production security boundary. Do not expose the default ports or secrets to an untrusted network.
