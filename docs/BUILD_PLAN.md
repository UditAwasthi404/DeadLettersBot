# Build Plan
## AgentOS — Grok Bot Clone

**Version:** 1.0  
**Date:** October 2026  
**Companion:** PRD.md, TRD.md, ARCHITECTURE.md, AGENTS.md

---

## Overview

AgentOS is built in 4 phases across ~24 weeks. Each phase ships a runnable, testable artifact. Later phases depend on earlier ones. Work within a phase can be parallelized across the tracks shown.

```
Phase 1 (Weeks 1–5)   → Core infrastructure: VM, host, agent loop, basic tools
Phase 2 (Weeks 6–10)  → Full agent runtime: memory, multi-bot, approval system
Phase 3 (Weeks 11–17) → Automation layer: skills, routines, connectors, MCP
Phase 4 (Weeks 18–24) → Desktop app, polish, self-host packaging, launch
```

---

## Monorepo Structure

```
agentOS/
├── packages/
│   ├── box-host/          # Server-side agent runtime (Bun/TypeScript)
│   ├── agent-core/        # Agent loop, context assembly, tool dispatch (shared)
│   ├── inference/         # Provider clients (xAI, OpenAI, Anthropic, Gemini, Ollama)
│   ├── tools/             # Tool implementations (browser, shell, file, connectors)
│   ├── memory/            # Memory stores and synthesis engine
│   ├── vm-manager/        # VM provisioning and lifecycle
│   ├── desktop/           # Electron desktop app (React + Tailwind)
│   ├── connectors/        # OAuth connector integrations
│   ├── routines/          # Skills and Routines engine
│   └── shared/            # Shared types, utilities, protocol definitions
├── infra/
│   ├── docker/            # Docker Compose for local dev
│   └── helm/              # Kubernetes Helm chart for production
├── docs/                  # All documentation (this folder)
└── scripts/               # Dev tooling, DB migrations, seed scripts
```

---

## Phase 1 — Core Infrastructure (Weeks 1–5)

**Goal:** A single bot can receive a message, run a multi-step tool loop on a real VM, and return a reply. No memory, no connectors, no desktop app yet.

### Track A: Box Host + Gateway (Weeks 1–3)

#### Week 1
- [x] **Repo scaffold** — monorepo with Turborepo/pnpm workspaces, TypeScript configs, shared linting (biome), CI pipeline skeleton (GitHub Actions).
- [x] **Shared types** (`packages/shared`) — define all protocol types: `Bot`, `Turn`, `Step`, `ToolCall`, `ToolResult`, `ModelMessage`, `BotConfig`, WebSocket frame types.
- [x] **Database setup** — PostgreSQL schema + Drizzle ORM migrations for: `accounts`, `bots`, `turns`, `steps`, `audit_log`. Redis connection setup.
- [x] **Blob store** — S3-compatible client (MinIO for local dev); bucket layout: `conversation-blobs/`, `summary-archives/`.

> Checkpoint: Phase 1 Week 1 Track A+B done — monorepo, shared types, Drizzle schema+migration, MinIO blob client, InferenceSession + OpenAI/Anthropic + fallback. Next: Week 2 Track A box-host (`runHostMain`, auth, WS gateway, send pipeline, run scheduler) and Track B Ollama + credential check.

#### Week 2
- [x] **Box Host process** (`packages/box-host`) — `runHostMain()` with process lock, crash handler, extension startup skeleton (8 steps, no-op stubs for now).
- [x] **Auth service** — JWT-based user sessions; bot-to-host pre-shared secret; middleware.
- [x] **WebSocket gateway** — accept `sendPrompt`, `interrupt`, `approve` frames; emit `accepted`, `token`, `message`, `settled`, `error` frames. Nonce-based deduplication.
- [x] **Send pipeline** — validate → dedupe → echo → admit. Separate acceptance response from durable write. Log non-durable accepts.
- [x] **Run Scheduler** — 3-lane queue per bot (`user` / `agent` / `background`) using Redis sorted sets. `enqueue()`, `dequeue()`, priority interrupt logic.

> Checkpoint: Phase 1 Week 2 Track A+B done — box-host `runHostMain` (lock, crash handlers, inferenceReady→db→redis→blob→recovery→gateway), JWT WS auth, sendPrompt dedupe/accept/enqueue, 3-lane Redis scheduler, Ollama + `inferenceReady`; turn shell/checkpoint/settle/recovery landed early. Next: Week 3 polish (agent-core context assembly) and Track C/D.

#### Week 3
- [x] **SandAgentRunner (turn shell)** — `createTurnRunShell()`: load conversation blob, prepare profile, create inference sessions, call `agent.runStream()`.
- [x] **Checkpoint system** — `checkpointChain`, `afterStepCheckpoint()`, `persistStepCheckpoint()`. Fire-and-forget with error logging. Run-generation rejection.
- [x] **Turn settlement** — `turn-settle()`: drain checkpoints → write agent blob → commit transcript mirror. Raise `TranscriptAppendAfterCheckpointError` on partial failure.
- [x] **Crash recovery** — on host startup: read in-progress turns from DB, resume ownership, re-enqueue stopped turns.

**Deliverable:** Box Host accepts a WebSocket connection, receives a `sendPrompt`, runs a no-op agent loop (no real model yet), checkpoints, and settles. Full persistence path exercised.

---

### Track B: Inference Layer (Weeks 1–2)

#### Week 1
- [x] **Provider interface** (`packages/inference`) — define `InferenceSession` interface: `streamComplete(messages, tools) → AsyncIterable<token | toolCall>`. Provider-agnostic.
- [x] **OpenAI provider** — implement interface using OpenAI API (gpt-4o). Stream tokens + tool calls. Separate main session vs summary session purposes.

#### Week 2
- [x] **Anthropic provider** — implement same interface using Anthropic API (claude-sonnet-4).
- [x] **Ollama provider** — implement interface for local models via Ollama HTTP API.
- [x] **Provider fallback chain** — if primary provider fails (rate limit, timeout, error) → try secondary → tertiary. Configurable per account.
- [x] **Credential check** — inference readiness check at startup (token present or mock mode).

**Deliverable:** Box Host can call any provider through a unified interface with automatic fallback.

---

### Track C: Agent Core + Basic Tools (Weeks 2–4)

#### Week 2
- [x] **AnysphereAgent (native loop)** (`packages/box-host/src/runner.ts`) — stream model output, dispatch tool calls, append results, checkpoint each step, and repeat. The loop is implemented in the host runner rather than a separate `agent-core` class.
- [x] **Stop condition evaluator** — the runner enforces a bounded step budget, exits on a model response without tool calls, polls cancellation, and honors `SendToUser` with `end_turn: true`.
- [x] **Static tool catalog** — initial set: `SendToUser`, `ReadFile`, `WriteFile`, `AppendFile`, `DeleteFile`, `ListDirectory`, `RunShell`.

#### Week 3
- [x] **Context assembly** (`packages/agent-core`) — `renderSystemPrompt()` with all 6 section groups. Section pinning + hash tracking. `assembleTurnAction()` for user turn messages. User-info message with tool schemas.
- [x] **Dynamic tool offloading** — `stableDynamicToolCatalog` gate (default: on). `GetDynamicTools` / `CallDynamicTool` stubs. Catalog diff updates via `deferUserInfoCatalogRerender()`.
- [x] **Tool routing** — `machineId` resolution: explicit ID → registered computer; absent → box VM.
- [x] **Permission adapter** — validate tool requests against bot's allowed tools; reject unadvertised tool names.

> Checkpoint: Phase 1 Week 3 Track C + Track D Week 2 done — agent-core prompt assembly (6 groups + hash), STATIC_CATALOG + dynamic stubs, checkPermission/dispatchTool wired into box-host runner; vm-manager VMManager + DockerVMManager/Noop. Next: Week 4 browser/web tools + real VM image / file+shell execution.

#### Week 4
- [x] **Browser tools** (`packages/tools`) — implement using Playwright + CDP: `BrowserNavigate`, `BrowserClick`, `BrowserType`, `BrowserScreenshot`, `BrowserExtractContent`, `BrowserScroll`, `BrowserWaitForElement`.
- [x] **Web tools** — `SearchWeb` (Brave Search API), `FetchURL` (HTTP GET + HTML→text extraction).
- [x] **`SendToUser` tool** — delivery callback + optional `end_turn` signal. Emits `message` frame on gateway.

**Deliverable:** Agent can receive a message, call browser tools on a real Playwright browser, and stream a reply back. End-to-end working for a single-step task.

---

### Track D: VM Manager (Weeks 2–4)

#### Week 2
- [x] **VM provisioning interface** (`packages/vm-manager`) — define `VMManager`: `provisionVM(accountId)`, `wakeVM(vmId)`, `suspendVM(vmId)`, `terminateVM(vmId)`, `getVMStatus(vmId)`.
- [ ] **Docker-based VM (dev)** — per-account Docker containers and dedicated per-account bridge networks are implemented with Chromium, Xvfb, bash, and persistent per-bot browser profiles on Debian Bookworm; the specified Ubuntu 22.04/Node.js image and verified container acceptance remain.

#### Week 3
- [ ] **Per-bot Xvfb screens** — on-demand Xvfb/Chromium instances now use a stable bot-ID mapping, separate display, CDP port, and persistent profile. Docker runtime acceptance remains.
- [ ] **Execution daemon** — Docker commands now use a tracked process-group wrapper; explicit turn interrupts abort shell/file commands and close the active per-bot browser connection. The loopback `box-execution-daemon` socket/protocol, unified CDP routing, caller-disconnect handling, and runtime acceptance remain.
- [ ] **Window router** — browser calls route to each bot's isolated CDP port. A disconnect-aware upstream router that cancels active browser requests and daemon acceptance remain.

#### Week 4
- [x] **VM lifecycle** — idle timeout (10 min → suspend). Wake on next message (cold start < 30s target). Health checks.
- [x] **Firecracker VMs (production path)** — Docker VM is production self-host path; Firecracker deferred.
- [x] **VNC + WebRTC relay** — deferred to Phase 4 (Secure Handoff needs desktop app).

**Deliverable:** Each account gets a real isolated VM (or container). Bots run Chromium on per-bot display numbers. Tool calls execute inside the VM.

---

### Phase 1 Exit Criteria
- [x] Single bot receives a message via WebSocket
- [x] Bot runs a multi-step browser task (navigate → extract → reply)
- [x] Each step is checkpointed and recoverable
- [x] Host crash mid-turn → restart → turn resumes from last checkpoint
- [x] Turn settles with conversation blob written to object storage
- [x] Transcript mirror committed to PostgreSQL
- [ ] End-to-end latency P95 < 10s for a 3-step task
- [x] All unit tests passing for: context assembly, tool routing, checkpoint chain, stop conditions

> Checkpoint: Core host, inference, checkpointing, Docker VM, and basic tools are implemented. Phase 1 is still open: per-bot Xvfb routing, the execution daemon/window router, latency target, and a verified end-to-end deployment remain.

---

## Phase 2 — Full Agent Runtime (Weeks 6–10)

**Goal:** Multi-bot roster, memory system, approval system, inter-bot messaging, and compaction. Core roster, memory CRUD, approvals, peer messaging, an initial subagent runtime, and generic synchronous compaction are implemented; memory synthesis, secure handoff, full subagent lifecycle, and runtime/50-turn compaction acceptance remain open.

### Track A: Memory System (Weeks 6–7)

#### Week 6
- [x] **Memory stores** (`packages/memory`) — `AgentMemoryStore`, `UserMemoryStore`, `ProjectMemoryStore` backed by PostgreSQL. CRUD: create, read, update, delete with scope/source/staleness metadata.
- [x] **Memory API** — REST endpoints: `GET/POST/PATCH/DELETE /v1/bots/{botId}/memory`. Memory export endpoint (`GET /v1/bots/{botId}/memory/export`). Memory viewer in desktop app (Phase 4).
- [x] **Memory prompt injection** — `[memory]` section in system prompt: user facts → project facts → agent facts, each with recall size limit.

#### Week 7
- [ ] **Post-turn memory extraction** — conservative extraction is enqueued transactionally with turn settlement and processed by a leased, durable retry worker. Each supporting turn is now recorded idempotently per fact and exposed through account/bot-scoped API and desktop memory UI; conflict review and runtime recovery acceptance remain.
- [ ] **Legacy extraction** — safe append-only extraction is implemented; add/update/delete review semantics and automatic conflict resolution remain intentionally unimplemented.
- [x] **Background synthesis** — opt-in `MEMORY_SYNTHESIS_ENABLED` worker queues jobs after extraction finds evidence, considers only repeated non-user-authored facts, asks a synthesis model and a separate verifier, and applies supported merges transactionally with optimistic-concurrency retries. Runtime acceptance and model-quality review remain.
- [x] **User-authored memory protection** — entries with `isUserAuthored: true` are never auto-overwritten.

---

### Track B: Approval and Permission System (Weeks 6–7)

#### Week 6
- [x] **Permission levels** — 4 levels (0=always, 1=first-time, 2=always-confirm, 3=secure-handoff). Tool catalog annotated with default level.
- [x] **Auto Review rules** — `AutoReviewRule` schema: `actionPattern` (regex) + `mode` ('require' | 'always_allow'). Stored per bot. `require` always wins over `always_allow`.
- [x] **`RequestApproval` tool** — pauses turn. Emits `needsApproval` frame on gateway. Waits for `approve` frame from client.
- [x] **In-flight decision** — `AllowOnce` / `Deny` / `AlwaysAllow`. `AlwaysAllow` persists to bot's policy store.

#### Week 7
- [x] **`SecureHandoff` tool** — pauses turn. Emits `secureHandoff` frame. Desktop app shows "Take Control" UI with VNC session. Bot resumes from checkpoint when user clicks "Return to Bot".
- [x] **Local PC execution** — the connected desktop runs approved shell commands. Default: require approval. Config: always-confirm / always-allow / never-allow.
- [x] **Audit log** — append-only table: every tool execution with tool name, params hash, machineId, approval status, outcome, timestamp. 90-day retention. `GET /v1/audit-log` endpoint.

---

### Track C: Multi-Bot System (Weeks 8–9)

#### Week 8
- [x] **Bot roster** — REST API: `POST/GET/PATCH/DELETE /v1/bots`. Roster list in DB. `[agent_directory]` prompt section populated from roster.
- [x] **`SendToAgent` tool** — route message to local bot inbox or remote peer. Priority flag. Sender identity in message.
- [x] **Bot inbox** — priority queue in Redis: `inbox:{botId}:priority` + `inbox:{botId}:normal`. Dedup set: `inbox:{botId}:dedup`.
- [x] **Wake mechanism** — `queueInboundAndWake()`: queue message → wake bot runner → prepend wake prompt. Priority messages interrupt background lane.
- [x] **Hop budget** — `hopCount` field on messages. Reject and notify user when hop budget exceeded.

#### Week 9
- [ ] **`CreateSubagent` tool** — implemented as a bounded child turn in the background lane with an isolated conversation, restricted read/browser/search tools, and a step budget; richer task categories and runtime verification remain.
- [ ] **TaskSubagent lifecycle** — durable completion metadata and parent revival turns are implemented; stall detection, restart/race verification, and lifecycle UX remain.
- [ ] **Subagent tracking** — status, timestamps, result, basic usage, cancellation, and `GetSubagentStatus` are implemented; steering, stall events, and verified token accounting remain.
- [x] **Less-fanout policy** — reuse an already queued/running executor for the same normalized task brief, tool set, and step budget before creating another child turn; differing tasks remain separate.

---

### Track D: Compaction (Week 10)

#### Week 10
- [x] **Compaction trigger** — estimate tokens from assembled context and compact synchronously at 80% of `MODEL_CONTEXT_TOKENS` (default 128,000; configurable from 8,000 to 2,000,000).
- [x] **Generic self-summary** — use the fallback summarization session with system instructions and archived history; insert the result as a clearly labeled user-role history carrier.
- [x] **Summary carrier** — archive the full original transcript under `summary-archives/`, retain recent complete exchanges, include the summary in the next context, and record the archive key on the settled turn.
- [x] **Pending summary adoption** — summarization is synchronous, so no pending summary is reused across turns and there is no stale-prefix adoption path.
- [x] **Context preservation on failure** — do not replace the conversation on summarization failure; if settlement fails after transcript replacement, restore the original transcript from the in-memory source.
- [ ] **Provider-specific compaction** — separate implementations for xAI, Anthropic, OpenAI styles. (Generic path as default; provider variants stubbed for v1.)

---

### Phase 2 Exit Criteria
- [ ] Two bots can coordinate: Bot A sends task to Bot B via `SendToAgent`; Bot B completes it and Bot A resumes
- [ ] Memory: facts from turn 1 appear in context on turn 2
- [ ] Memory: user can view, edit, delete memory entries via API
- [ ] Approval: RunShell call triggers approval UI; Allow Once executes; Deny blocks
- [ ] Secure Handoff: bot pauses, user takes VM screen control, bot resumes
- [ ] Compaction: 50-turn conversation compacts; bot answers question about turn 1 correctly after compaction
- [ ] Subagent: spawned, executes browser task, returns result to parent
- [ ] Hop budget: chain of 6 bots is blocked at hop 5

---

## Phase 3 — Automation Layer (Weeks 11–17)

**Goal:** Skills, Routines, full connector suite, MCP. PRD v1.5 complete.

### Track A: Skills Engine (Weeks 11–13)

#### Week 11
- [x] **Skill schema** — `Skill` model: id, name, description, `SkillStep[]`, approval points, error policy, version, rollback support.
- [x] **Skill CRUD API** — `GET/POST/PATCH/DELETE /v1/skills`. Versioned storage in object store: `skills/{accountId}/{skillId}/v{N}.json`.
- [x] **Skill injection** — inject skill steps into agent system prompt `[skills]` section when skill is active. Bot follows steps as instructions.

#### Week 12
- [x] **Browser recording ingest** — CDP navigation, click, type, and scroll events are recorded for at most 10 minutes. One inference call turns the log into draft `SkillStep[]` for review.
- [x] **"Teach a task" flow** — desktop skills panel: Start Recording, Stop Recording, edit the draft, then save through the versioned skill API.
- [ ] **Skill approval points** — routine-attached skills expose `CompleteSkillStep`, permit multiple tool calls within the current instruction, and pause before annotated steps. Turn checkpoints now restore skill progress and transcript context; in-flight tool action(s) may repeat if the process exits before their results are checkpointed, and runtime acceptance verification remains.
- [ ] **Skill error handling** — runtime enforces `stop`, bounded configurable `retry` (1–10 failed actions, default 3), `skip`, `notify_user`, and bounded `custom_prompt` recovery, persisting retry counts in turn checkpoints; the desktop exposes policy, limit, and recovery text. Runtime acceptance verification remains.

#### Week 13
- [x] **Skill test runner** — `POST /v1/skills/{skillId}/test` queues one routine turn for that skill and an account bot. The desktop requires confirmation because the run uses real tools.
- [x] **Skill sharing and routine assignment** — account-scoped `POST /v1/skills/{skillId}/assign` copies a skill and creates its initial version snapshot transactionally; routines can be reassigned to compatible account bots and skills through the API and desktop. Runtime acceptance remains.

---

### Track B: Routines Engine (Weeks 13–15)

#### Week 13
- [x] **Routine schema** — `Routine` model: id, botId, skillId, name, trigger, enabled, history (last 20 runs).
- [x] **Routine CRUD API** — `GET/POST/PATCH/DELETE /v1/routines`. `POST /v1/routines/{id}/test` (real execution, with warning).
- [x] **Cron trigger** — numeric five-field cron matcher with minute polling and persisted last-trigger time.

#### Week 14
- [x] **Webhook trigger** — `POST /v1/webhooks/{routineId}` endpoint. Validate shared secret. Enqueue routine on background lane.
- [ ] **Connector event trigger** — poll connector APIs for new events (e.g., new Gmail message). Configurable filter (subject match, sender, label). Trigger matching routines.
- [x] **File change trigger** — `inotifywait` on a path inside `/home/agent`. Bursts debounce for 1 second, then the routine is queued and written to history.
- [ ] **Inter-bot message trigger** — API and runtime support are implemented with an optional sender filter and hop-count propagation; desktop creation/editing controls are implemented; runtime verification remains.

#### Week 15
- [x] **Routine history** — store last 20 runs per routine: triggered_at, status, duration, input_summary, output_summary, error_message. `GET /v1/routines/{id}/history`.
- [x] **Error handling** — `onError: notify_user` → SendToUser in parent chat. `onError: retry` → up to 3 retries with exponential backoff. Permanently failed → pause + flag in UI.
- [ ] **Automation sync** — reconcile local routine definitions with hosted shadow schedules on startup. `isBoxHostedForAutomationSync` flag. Explicit sync call required to delete remote schedules.
- [x] **50-routine limit** — enforce per account. Return `429 Routine limit reached` on creation if exceeded.

---

### Track C: Connectors (Weeks 14–16)

#### Week 14
- [x] **OAuth 2.0 PKCE flow** — Google OAuth state, PKCE, token exchange, refresh. Tokens stored encrypted (AES-256-GCM) in DB.
- [x] **Gmail connector** — scopes: read, send, labels, attachments. Tool actions: `ListMessages`, `ReadMessage`, `SendMessage`, `ApplyLabel`, `GetAttachment`.
- [x] **Google Calendar connector** — scopes: read, write, free/busy. Tool actions: `ListEvents`, `CreateEvent`, `UpdateEvent`, `DeleteEvent`, `GetFreeBusy`.

#### Week 15
- [x] **Google Drive connector** — Google OAuth `drive` scope and unified `ConnectorCall` actions `ListFiles`, bounded text `ReadFile`, text/JSON `WriteFile` (1 MB maximum), and `ShareFile`; OAuth/API/UI runtime acceptance remains.
- [x] **OneDrive connector** — Microsoft OAuth shared with the other Microsoft services. Tool actions: `ListFiles`, bounded text `ReadFile`, text/JSON `WriteFile` (1 MB), `ShareFile`. Live consent acceptance remains.
- [x] **Outlook Mail connector** — same Microsoft connection. Tool actions: `ListMessages`, `ReadMessage`, `SendMessage`, `ApplyLabel`, `GetAttachment`. Live consent acceptance remains.

#### Week 16
- [x] **Outlook Calendar connector** — same Microsoft connection. Tool actions: `ListEvents`, `CreateEvent`, `UpdateEvent`, `DeleteEvent`, `GetFreeBusy`. Live consent acceptance remains.
- [x] **Microsoft Teams connector** — `ListChannels`, `PostMessage`, `ReadChannel`, `ListFiles` on the shared Microsoft connection. Live consent acceptance remains.
- [x] **SharePoint connector** — `ListSites`, `ListItems`, `ReadItem`, `WriteItem` on the shared Microsoft connection. Live consent acceptance remains.
- [x] **Salesforce connector** — OAuth web-server flow via the PKCE client. Tool actions: `QueryRecords`, `GetRecord`, `CreateRecord`, `UpdateRecord`. Live consent acceptance remains.
- [ ] **Connector disconnect** — OAuth revocation is attempted, stored credentials are deleted transactionally with an audit record, and the desktop reports provider-revocation failures. Clearing service cookies in VM browser profiles remains unimplemented; current connector OAuth uses backend tokens rather than those profiles, and runtime acceptance remains.
- [x] **`ConnectorCall` tool** — unified `ConnectorCall(service, action, params)` dispatches Gmail, Calendar, Drive, OneDrive, Outlook Mail, Outlook Calendar, Teams, SharePoint, and Salesforce. Unknown actions are rejected. Live provider acceptance remains.

---

### Track D: MCP Support (Weeks 16–17)

#### Week 16
- [x] **MCP client** (`packages/tools/mcp`) — connect to configured MCP server URL + bearer API key. Discover tools via `tools/list`. Cache tool metadata in PostgreSQL; refresh on calls.
- [x] **MCP deadline** — enforce 5-second deadlines on discovery and tool calls.
- [x] **`MCPCall` tool** — dispatch a call to a connected MCP server tool. Tag results as untrusted external data in the context.
- [x] **MCP prompt injection defense** — scan tool names and descriptions for common injection patterns and warn; `MCP_STRICT_MODE=1` blocks discovery and calls when suspicious metadata is present.

#### Week 17
- [x] **MCP management API** — `GET/POST/DELETE /v1/connectors/mcp`. Add MCP server URL + API key. Stores with encryption. Startup and 60-second background probes refresh last-known health with bounded concurrency without invoking tools.
- [x] **MCP multi-account guidance** — when an account has multiple MCP servers, the prompt instructs the agent to choose by configured server name/tool, use the exact server ID, avoid cross-server data movement unless requested, and treat metadata/results as untrusted.
- [x] **`[mcp_instructions]` + `[mcp_status]` prompt sections** — connected tool names/descriptions and last-known status are included in the environment section.
- [ ] **Tunneling docs** — HTTPS tunnel guidance documented; tunnel health checks remain.

---

### Phase 3 Exit Criteria
- [ ] Skill created from text description → bot executes all steps → approval point pauses execution
- [ ] "Teach a task" recording → draft skill → user edits → bot executes
- [ ] Routine with cron trigger fires at scheduled time, executes skill, logs to history
- [ ] Webhook trigger fires routine via HTTP POST
- [ ] Gmail connector: bot reads new emails and replies using `SendMessage`
- [ ] Google Calendar connector: bot creates an event
- [ ] Salesforce connector: bot queries and updates a record
- [ ] MCP server connected: bot discovers and calls a custom tool
- [ ] 50-routine limit enforced
- [ ] Routine error → user notified in chat

---

## Phase 4 — Desktop App, Polish, and Launch (Weeks 18–24)

**Goal:** Production-ready desktop app, self-hosting packaging, security hardening, performance optimization, and public launch.

### Track A: Desktop App (Weeks 18–21)

#### Week 18 — Core Shell
- [x] **Electron app scaffold** (`packages/desktop`) — Electron, React 19, and Vite with renderer / preload / main separation. Styling stays in `style.css`.
- [x] **Gateway client** — WebSocket client in Electron Main. Reconnect uses exponential backoff capped at 30 seconds and stops on user disconnect or quit. The gateway URL and bearer token are restored from the Electron session.
- [x] **Bot roster sidebar** — list all bots. Create / rename / delete. Select active bot. (Rename/delete are limited by the API's history-protection rule.)
- [x] **Chat view** — streaming message display. Tool call visualization (show tool name + collapsible params/result). Approval UI inline in chat.

#### Week 19 — Full Chat Features
- [x] **File attachments** — drag-and-drop files into chat. Send as attachment in `sendPrompt`.
- [x] **Interrupt button** — "Stop" button during active turn. Sends `interrupt` frame.
- [x] **Approval dialogs** — inline Allow Once / Deny / Always Allow decision. Auto Review rule creation from UI. (Auto Review editor is API-only.)
- [x] **Secure Handoff UI** — "Take Control" screen opens embedded VNC view of VM. "Return to Bot" button.
- [x] **VM screen viewer** — "View Agent Screen" opens the same VNC session while the turn keeps running.

#### Week 20 — Memory, Skills, Routines UI
- [x] **Memory viewer** — list all memory entries per bot. Show scope, source, timestamp, staleness. Edit and delete inline.
- [x] **Memory export** — "Export Memory" button → download JSON.
- [x] **Skills UI** — list, versioned edit, step error policies, drag reorder, delete, and Teach a Task recording are in the desktop. Runtime acceptance remains.
- [x] **Routines UI** — list, cron/webhook/file-change/inter-bot creation, cron preview, one-time webhook secret, pause/resume, confirmed test, delete, and the last 20 history rows are in the desktop. Runtime acceptance remains.

#### Week 21 — Connectors and Settings
- [x] **Connectors panel** — Gmail, Calendar, Drive, OneDrive, Outlook Mail, Outlook Calendar, Teams, SharePoint, and Salesforce. Microsoft services share one OAuth connection. Disconnect asks for confirmation.
- [x] **MCP servers panel** — add/remove MCP server URLs with masked API-key entry. Show discovered tool count and last-known health/check time.
- [x] **Account settings** — per-bot provider/model selection and a retain-data preference are in the desktop and API. Disabling retention does not delete stored memory.
- [x] **Local computer execution settings** — Always Require Approval / Always Allow / Never Allow toggle.
- [x] **Auto-update** — packaged builds check electron-updater and show a restart banner. The GitHub publish owner and repo are placeholders.

---

### Track B: REST API and SDK (Weeks 18–19)

#### Week 18
- [x] **OpenAPI spec** — `/openapi.json` is generated with Zod request and response schemas for health, bots, memory, skills, routines, connectors, MCP, audit, API keys, and webhooks. Bearer auth is the default for `/v1`. Formal validation of every handler against the document remains.
- [x] **Rate limiting** — per-account fixed-window rate limits on authenticated API endpoints in Redis.
- [x] **API key management** — create / revoke API keys for programmatic access. Scoped: read-only, read-write, admin.

#### Week 19
- [x] **TypeScript SDK** (`packages/sdk`) — `AgentOSClient` and `AgentOSError` cover bots, memory, skills, routines, connectors, MCP, audit, and API keys, and accept either `(baseUrl, token)` or an options object. OpenAPI-generated types and npm publication remain.
- [ ] **Webhook delivery** — signed POST events for turn settled, routine completed, and approval required use a durable queue with bounded retries, account-scoped history, configurable terminal-record retention, and manual retry. Desktop subscription and delivery management is implemented; end-to-end acceptance remains.
- [x] **API docs** — `GET /docs` serves Scalar against `/openapi.json`.

---

### Track C: Self-Hosting Packaging (Weeks 20–22)

#### Week 20
- [x] **Docker Compose** — Compose stack includes `box-host` with a `/health` check, `postgres`, `redis`, `minio`, and the VM image build. Optional Caddy TLS uses `CADDY_DOMAIN` or `AGENTOS_DOMAIN`. The VM manager runs inside box-host. Deployment acceptance remains.
- [x] **Environment config** — `.env.example` documents store, JWT, connector, Google, Microsoft, Salesforce, Brave, inference, and port settings. Host startup validates required settings; a live credential check remains.
- [x] **First-run setup script** — `scripts/setup.sh` generates development secrets and starts Compose; account bootstrap and bot creation are performed through the API. Runtime deployment acceptance remains.
- [x] **Health check endpoints** — `GET /health` (liveness), `GET /ready` (readiness).

#### Week 21
- [ ] **Helm chart** (`infra/helm/`) — initial chart now provisions a single `box-host`, PostgreSQL, Redis, MinIO, PVCs, Secrets, and optional Ingress. Isolated `vm-manager`, HPA, cert-manager resources, and Kubernetes runtime acceptance remain; current Docker VM network/browser routing cannot run correctly inside this chart.
- [x] **VM garbage collector** — `gcIdleVMs` terminates account VMs idle for 30 days and runs every 24 hours. `accounts.last_active_at` is updated when a turn starts. A 7-day warning is not sent yet.
- [x] **Backup/restore** — `scripts/backup.sh`: dump PostgreSQL + export S3 blobs. `scripts/restore.sh`. Document frequency recommendations.

#### Week 22
- [x] **Self-hosting docs** — `docs/SELF_HOSTING.md` covers Compose, Kubernetes limits, Caddy and cert-manager TLS, and minimum VM sizes. Live cluster acceptance remains.
- [ ] **Resource sizing guide** — initial capacity estimates and scaling inputs are documented in `docs/RESOURCE_SIZING.md`; measured concurrency benchmarks and current AWS/GCP/Hetzner costs remain.
- [ ] **Upgrade guide** — forward migration, backup, Compose upgrade, and restore guidance is documented in `docs/UPGRADING.md`; zero-downtime rolling deployment remains unsupported and unverified.

---

### Track D: Security Hardening (Weeks 21–22)

#### Week 21
- [x] **Secrets rotation** — JWTs that verify with `JWT_SECRET_PREVIOUS` are re-signed with `JWT_SECRET` and returned in `X-AgentOS-Refreshed-Token`. Connector, MCP, and webhook secrets decrypted with the previous key are re-encrypted on read. Runtime rotation acceptance remains.
- [ ] **Network egress policy** — VM-level `iptables` rules for egress filtering. Optional `getEgressPolicy(domains/CIDR/ports)` enforcement per account.
- [x] **Prompt injection hardening** — FetchURL strips HTML before the 8,000-character cap. MCP, web, browser, file, shell, and connector results are wrapped in one `[UNTRUSTED_EXTERNAL_DATA]` envelope. Regex HTML reduction is not a parser, and adversarial runtime checks remain.
- [ ] **Shell sandboxing** — `RunShell` now enters unprivileged user, PID, mount/proc, and network namespaces with `unshare`; the Docker VM executes it as `agent` with all Linux capabilities dropped and `no-new-privileges`. Runtime image/namespace acceptance remains.

#### Week 22
- [x] **Security audit** — `docs/SECURITY_AUDIT.md` records the SQL, path, XSS, and shell review plus the rotation and untrusted-data changes. DNS pinning and a running penetration test remain.
- [x] **Dependency audit** — weekly Dependabot updates configured, all direct package versions are pinned, and the full `pnpm audit` reports zero advisories.
- [ ] **OWASP checks** — verify: no SQL injection (parameterized queries throughout), no XSS in desktop app, no path traversal in file tools.
- [x] **Pen test checklist** — `docs/PEN_TEST_CHECKLIST.md` covers JWT forgery, scope isolation, path traversal, XSS, MCP redirects/DNS, injection, secret rotation, and recovery; execution and findings remain.

---

### Track E: Performance and Observability (Weeks 22–23)

#### Week 22
- [ ] **OpenTelemetry** — direct Prometheus instrumentation now covers gateway latency, turn duration, step duration, inference latency, tool execution time, memory extraction time, and checkpoint write time with bucketed latency histograms. OpenTelemetry SDK/tracing integration and runtime scrape verification remain.
- [ ] **Grafana dashboards** — four provisioned dashboards and optional Prometheus/Grafana Compose services are implemented. VM dashboard currently shows VM-related tool activity rather than container health gauges; runtime validation remains.
- [ ] **Structured logging** — basic JSON HTTP request logs include request IDs, method, path, status, and duration. Pino integration and bot/turn correlation across all logs remain.

#### Week 23
- [ ] **Prompt cache optimization** — verify section hashing works correctly; test cache hit rate with provider (xAI, Anthropic). Target: > 70% cache hit on groups 1–3.
- [ ] **Context assembly benchmarks** — `renderSystemPrompt()` P99 < 200ms under 100 concurrent bots.
- [ ] **Checkpoint write benchmarks** — P95 < 500ms. Tune PostgreSQL write settings + connection pool.
- [ ] **VM cold start optimization** — target < 30s. Pre-warm VM pool (keep N VMs in standby).
- [ ] **Load test** — `k6` load test: 100 concurrent turns, 5 steps each, with browser tool calls. Measure P50/P95/P99 latency.

---

### Track F: Launch Prep (Weeks 23–24)

#### Week 23
- [ ] **Integration tests** — full E2E suite (Playwright): create bot → send message → view reply → check memory → create skill → create routine → run routine → check history.
- [ ] **Eval suite** — 50 benchmark tasks across: web research, email drafting, calendar management, file operations, multi-bot coordination. Measure task completion rate (target ≥ 80%).
- [ ] **Regression suite** — run eval suite on every PR merge. Fail PR if task completion rate drops by > 5%.

#### Week 24
- [x] **README** — root `README.md` covers the project, Docker Compose quickstart, feature overview, and documentation links; a fresh-tester run remains an exit criterion.
- [x] **CONTRIBUTING.md** — contribution and development guide covers code practices and pull requests.
- [x] **LICENSE** — MIT license file present.
- [ ] **GitHub release** — tag v1.0.0, write release notes, attach desktop app binaries (macOS + Windows).
- [ ] **Docker Hub publish** — push `agentOS/box-host:1.0.0`, `agentOS/vm-manager:1.0.0` images.
- [ ] **npm publish** — publish `@agentOS/sdk@1.0.0`.

---

### Phase 4 Exit Criteria
- [ ] Desktop app installs on macOS and Windows from DMG/installer without extra steps
- [ ] Complete E2E test suite passing
- [ ] Eval suite: ≥ 80% task completion rate
- [ ] Docker Compose self-host: `docker compose up` → working system in < 5 minutes
- [ ] Helm chart deploys successfully to a fresh Kubernetes cluster
- [ ] P95 turn latency < 10s (measured under load test)
- [ ] Security audit findings resolved (no critical/high open)
- [ ] README quickstart verified by a fresh tester with no prior knowledge

---

## Dependency Graph (Cross-Phase)

```
Phase 1                          Phase 2                    Phase 3
─────────────────────────────    ──────────────────────    ─────────────────────
DB schema + blob store
    │
    ▼
Box Host + Gateway ──────────────► Approval System ──────► Connectors
    │                                     │
    ▼                                     ▼
Inference Layer ─────────────────► Compaction ────────────► MCP Support
    │
    ▼
Agent Core + Context Assembly ───► Memory System ──────────► Skills Engine
    │
    ▼
Basic Tools (file/shell) ────────► Multi-Bot System ───────► Routines Engine
    │
    ▼
VM Manager + Browser Tools                                 Phase 4
                                                           ──────────────────────
                                                           Desktop App
                                                           (requires Phase 1–3)
                                                               │
                                                           Self-Host Packaging
                                                               │
                                                           Security Hardening
                                                               │
                                                           Performance + Launch
```

---

## Test Strategy

| Layer | Framework | Coverage Target |
|-------|-----------|----------------|
| Unit (agent-core, memory, inference) | Vitest | 90% |
| Unit (tools, connectors) | Vitest | 80% |
| Integration (box-host) | Vitest + test containers | Key paths |
| E2E (full system) | Playwright | Critical user journeys |
| Eval (task completion) | Custom harness | 50 benchmark tasks |
| Load | k6 | 100 concurrent turns |

Eval mode (`--eval-mode`) is used in CI for all tests that exercise the agent loop — no live model or real account needed.

---

## Tech Stack Summary

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Bun (TypeScript) | Fast startup, native TypeScript, good DX |
| Framework | Hono (HTTP) + ws (WebSocket) | Lightweight, performant |
| ORM | Drizzle ORM | Type-safe, SQL-first, migrations included |
| Database | PostgreSQL 16 | ACID, row-level locking for admission ledger |
| Cache/Queue | Redis 7 | Fast sorted sets for scheduler lanes |
| Blob Store | MinIO (dev) / S3 (prod) | S3-compatible, self-hostable |
| Browser | Playwright + Chromium | Reliable CDP, official Playwright support |
| Desktop | Electron 32 + React 19 + Tailwind | Cross-platform, matches Grok Bot desktop |
| Inference | Vercel AI SDK | Multi-provider, streaming, typed tool calls |
| VM (dev) | Docker-in-Docker | Easy local setup |
| VM (prod) | Firecracker microVMs | Fast, lightweight, secure |
| Screen share | WebRTC (via mediasoup) | Low-latency VM screen in desktop app |
| Observability | OpenTelemetry → Prometheus → Grafana | Standard self-hostable stack |
| CI | GitHub Actions | Native GitHub integration |
| Infra (dev) | Docker Compose | One command to run everything |
| Infra (prod) | Kubernetes + Helm | Standard production deployment |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| VM provider costs too high for free tier | High | High | Sleep VMs aggressively; use Firecracker (50MB RAM per VM vs 8GB) |
| Browser automation flakiness | High | Medium | Playwright retry policies; screenshot-on-failure logging; fallback to simpler selectors |
| Model provider rate limits during load test | Medium | High | Fallback chain; eval mode for CI (no real model) |
| Compaction causes context loss | Medium | High | Strict "preserve on failure" requirement; integration tests for every compaction path |
| MCP injection attack | Medium | High | Untrusted tagging + strict mode option; document in security guide |
| Electron app size too large | Low | Low | Tree-shake; lazy-load non-critical panels |
| Desktop 0.52 ↔ host 17e335e IPC incompatibility (from RE) | Low | Medium | Implement own defined protocol; don't depend on undocumented compatibility |

---

## Milestones

| Milestone | Week | Deliverable |
|-----------|------|-------------|
| **M1 — Host Alive** | 3 | Box Host accepts WebSocket, runs no-op agent loop, checkpoints, settles |
| **M2 — Agent Works** | 5 | Bot completes multi-step browser task end-to-end, crash recovery verified |
| **M3 — Memory + Approval** | 8 | Memory persists across sessions; approval system blocks/allows tool calls |
| **M4 — Multi-Bot** | 10 | Two bots coordinate; subagent spawns and returns result |
| **M5 — Compaction** | 10 | 50-turn conversation compacts; bot retains context across compaction |
| **M6 — Skills + Routines** | 15 | Routine fires on schedule, executes skill, logs history |
| **M7 — Full Connectors** | 16 | Gmail + Calendar + Salesforce connectors working end-to-end |
| **M8 — MCP** | 17 | Custom MCP server connected; bot discovers and calls tools |
| **M9 — Desktop Alpha** | 21 | Desktop app installable; full chat + approval + memory + skills UI |
| **M10 — Self-Host Beta** | 22 | Docker Compose self-host works in < 5 minutes |
| **M11 — v1.0 Launch** | 24 | All exit criteria met; GitHub release + Docker images published |
