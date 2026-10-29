# Technical Requirements Document (TRD)
## Grok Bot Clone — "AgentOS"

**Version:** 1.0  
**Date:** October 2026  
**Status:** Draft  
**Companion:** PRD v1.0, ARCHITECTURE.md

---

## 1. Overview

This document defines the technical requirements for AgentOS — an open-source Grok Bot clone. It is derived from reverse-engineering the Grok Bot harness (host 17e335e / desktop 0.52–0.57), xAI's public disclosures, and independent runtime measurements of the Grok Bot protocol. All source analysis is based on emitted JavaScript (not original TypeScript); behaviors marked **[S]** are source-confirmed, **[I]** are inferred, and **[U]** are unresolved.

---

## 2. System Component Requirements

### 2.1 Box Host (Server-Side Agent Runtime)

The Box Host is the central server process that runs the agent loop, manages state, and orchestrates all services.

#### 2.1.1 Process Architecture
- **REQ-H01:** The host MUST run as a standalone Node.js/Bun process, separate from the desktop app.
- **REQ-H02:** The host MUST support multiple simultaneous agent sessions (one per bot per active turn).
- **REQ-H03:** The host startup sequence MUST initialize extensions in dependency order: Auth → Stores → Runner Composition → Gateway → Identity → Automations → Capabilities → Telemetry.
- **REQ-H04:** The host MUST implement crash recovery: on restart, it MUST resume ownership of saved in-progress turns.
- **REQ-H05:** The host MUST support an eval entry point (`--eval-mode`) that reads a request file and writes results, accepts system prompt overrides and tool disable lists.

#### 2.1.2 Gateway and Send Pipeline
- **REQ-H06:** The gateway MUST accept `sendPrompt(args)` over an authenticated WebSocket/HTTP2 connection.
- **REQ-H07:** The pipeline MUST validate, deduplicate (by nonce/input hash), echo the sent message, and return an acceptance response before the turn finishes.
- **REQ-H08:** The acceptance response and the durable write MUST be separate events; a database lock failure MUST be logged with a flag indicating the input was not saved durably.
- **REQ-H09:** An HTTP 200 from `sendPrompt` MUST NOT be treated as proof of durable persistence.

#### 2.1.3 Run Scheduler and Lifecycle
- **REQ-H10:** The scheduler MUST maintain three queues per agent: user lane, agent lane (peer messages), and background lane (routines).
- **REQ-H11:** Within the user lane, the scheduler MUST prefer items that are not group-member work.
- **REQ-H12:** A priority peer message MUST be able to interrupt a background-lane task.
- **REQ-H13:** Cancellation MUST propagate from: the run lifecycle → the active inference stream → the active tool context → the execution daemon child process.

#### 2.1.4 Agent Runner and Turn Shell
- **REQ-H14:** `createTurnRunShell` MUST copy the saved binary conversation structure, prepare profile updates, create main and summary inference sessions, then call `agent.runStream`.
- **REQ-H15:** After each step, the runner MUST: append response and tool messages to history, apply history changes, compute next state, call `onStateUpdate`, then call `afterStepCheckpoint`.
- **REQ-H16:** The checkpoint persistence promise MUST be chained through `checkpointChain`; callbacks from old run generations MUST be rejected.
- **REQ-H17:** Checkpoint errors MUST be caught and logged; fire-and-forget persistence errors MUST NOT crash the turn.
- **REQ-H18:** Turn settlement MUST: drain checkpoints → write agent checkpoint → commit transcript mirror → run memory extraction.
- **REQ-H19:** `TranscriptAppendAfterCheckpointError` MUST be raised if checkpoint succeeds but the later transcript step fails.

### 2.2 Native Agent Loop

#### 2.2.1 Step Execution
- **REQ-A01:** The agent loop MUST execute steps: model stream → parse tool calls → resolve + validate + execute tools → append results → checkpoint → evaluate stop condition → repeat.
- **REQ-A02:** Stop conditions MUST include: step limit reached, no tool calls and no queued messages, cancellation received, `SendToUser` delivery with `end_turn: true`.
- **REQ-A03:** Tool schemas and reminders MUST be supplied to each model call, not just the first.
- **REQ-A04:** Post-step callbacks (`afterStepCallback`) MUST run after tool results are appended.
- **REQ-A05:** The `SendToUser` tool MUST trigger the delivery callback first, then request turn completion if `end_turn: true` is wired.

#### 2.2.2 Tool Dispatch
- **REQ-A06:** Tools MUST be routed by `machineId`: explicit machineId → registered computer, absent machineId → box (cloud VM).
- **REQ-A07:** Tool categories: static catalog (always available), dynamic catalog (gated, loaded via `GetDynamicTools` / `CallDynamicTool`).
- **REQ-A08:** Dynamic tool offloading MUST be enabled by default (`stableDynamicToolCatalog` gate = true).
- **REQ-A09:** The dynamic catalog MUST update via `deferUserInfoCatalogRerender` — tool namespace changes, subagent type changes arrive as a new user turn without rebuilding the full prefix.
- **REQ-A10:** Permission adapters MUST validate tool requests; unadvertised tool names MUST be rejected.
- **REQ-A11:** Local machine tools (requiring local execution daemon) MUST use `localMachineId` routing and require explicit user permission.

### 2.3 Context Assembly and Prompt System

#### 2.3.1 System Prompt Assembly
The system prompt is assembled in this fixed order (matching Grok Bot host 17e335e):

| Order | Section | Contents |
|-------|---------|----------|
| 1 | `base` | Host persona, capabilities, stop policy, security guidance |
| 1 | `spotlight` (optional) | Feature spotlight, gated |
| 1 | `voice_channel` (optional) | Voice-specific instructions; excluded for subagent runners |
| 2 | `profile` | Bot name, saved profile text, role instructions |
| 2 | `user_identity` | User identity context |
| 2 | `team_bot` | Team/group bot role instructions |
| 2 | `multitask` | Multi-task / multi-bot context |
| 3 | `internal_details_boundary` | Discourages disclosure of architecture (gated) |
| 3 | `mcp_multi_account` | MCP multi-account guidance |
| 3 | `user_form` | User-facing form interaction guidance |
| 3 | `draft_external_message` | Draft email/message guidance |
| 3 | `timezone` | User timezone |
| 4 | `memory` | Learned facts: user facts → project facts → agent facts |
| 4 | `current_session` | Current session context |
| 4 | `active_sessions` | Other active bot sessions |
| 5 | `automations` | Available automations/routines |
| 5 | `skills` | Available skills (or skill discovery instructions if skillified) |
| 5 | `stripe_link_purchasing` | Purchase guidance (gated) |
| 5 | `channels` | Available communication channels |
| 6 | `agent_directory` | Peer bot roster (names visible even when histories are separate) |
| 6 | `group_chat_turns` | Group chat context |
| 6 | `mcp_instructions` | MCP connector guidance |
| 6 | `mcp_status` | MCP connector status |
| 6 | `remote_box` | Remote box environment guidance |
| 6 | `bot_secrets` | Bot secrets (gated) |
| 6 | `computer` | Execution environment description |

- **REQ-P01:** The assembler MUST hash each section to detect changes.
- **REQ-P02:** Sections 1–3 MUST be pinned (frozen) between compaction epochs to support provider prompt caching.
- **REQ-P03:** Live changes (memory updates, profile changes) MUST arrive as notes in the new user turn message; the pinned section is NOT immediately rewritten.
- **REQ-P04:** After compaction, pinned sections MUST be refreshed with current values.
- **REQ-P05:** If user memory becomes unavailable, any pin still containing it MUST be invalidated.

#### 2.3.2 User Turn Message Assembly (`assembleTurnAction`)
Order of fields in the user turn message:
1. Address + machine + reply context
2. User's text
3. Attachment notes
4. Automation-status updates
5. Profile and instruction updates
6. Reply reminders and unfinished-task reminders
7. `<system_reminder>` tags (do NOT change the API role to system)
8. Images / video structured context
9. Recent messages / shell-watch material (prepended)
10. Unanswered / dismissed question context (prepended)

- **REQ-P06:** Hidden wake messages MUST be tagged as hidden and untrusted.
- **REQ-P07:** The `isSilenceAllowed` flag MUST reverse update order (prepend instead of append).

#### 2.3.3 User Info / Catalog Message
- **REQ-P08:** A `user_info` message (rules, skills, catalogs) MUST be prepended to the model's history before the first turn.
- **REQ-P09:** With `stableDynamicToolCatalog` gate on, catalog changes MUST be sent as a diff message referencing named sections being replaced.
- **REQ-P10:** Request-context recovery, summaries, and team-rule changes MUST retain separate rerender flags.

### 2.4 Compaction (Context Summarization)

- **REQ-C01:** Compaction MUST trigger when the conversation approaches the model's context limit (configurable threshold).
- **REQ-C02:** Generic self-summary: send system + user-info prefix + history + summary request as a user message; the summary becomes a user-role message in the next context.
- **REQ-C03:** External summarizer: also uses a user-role message marked with `isSummary = true`.
- **REQ-C04:** xAI native compaction MUST include the original system and catalog (like Grok Bot `e6e1fb3`+); generic path behavior differs.
- **REQ-C05:** Summary instructions MUST request a technical handoff covering: user intent, relevant facts/code, errors and fixes, solved and open problems, pending tasks, current work, and a supported next step.
- **REQ-C06:** After a failed summary, the original context MUST be preserved (preserving context is a hard requirement).
- **REQ-C07:** Before reusing a pending summary, the orchestrator MUST compare the original message prefix with current messages.
- **REQ-C08:** After compaction, the `frozen` epoch MUST advance; the model prompt prefix is now the summary + latest user query + user-info.
- **REQ-C09:** Native compaction and history must be separately stored: `root_checkpoints`, `blob_store`, and `summary_archives` are distinct stores.

### 2.5 Memory System

#### 2.5.1 Architecture
- **REQ-M01:** Three memory stores: `AgentMemoryStore`, `UserMemoryStore`, `ProjectMemoryStore`.
- **REQ-M02:** Memory is separate from conversation blobs; changing one does not corrupt the other.
- **REQ-M03:** Memory shard routing: `writeMemory(scope: 'agent' | 'user' | 'project')` → `memoryShardFor(scope)`.
- **REQ-M04:** If scope is omitted, fall back to `agent` scope.
- **REQ-M05:** Project memory requires an existing project record AND bot membership in that project.

#### 2.5.2 Extraction and Synthesis
- **REQ-M06:** After each turn, run `runTurnMemory`:
  1. Check `recordMemoryEvidence` — if available, record exchange evidence, clear pending episode turns, return.
  2. Otherwise, run legacy extraction: record episode turns, optionally generate episode narrative, parse and apply returned changes.
- **REQ-M07:** Background synthesis (`sand_memory_dreaming` gate): summarize evidence, propose changes with citations, verify via a second model pass, apply against saved snapshot.
- **REQ-M08:** Synthesis MUST treat existing memory state as untrusted data; must cite evidence for every change; must not speculate; MUST NOT overwrite user-authored entries without explicit evidence.
- **REQ-M09:** A stale snapshot during synthesis MUST trigger another pass (optimistic concurrency).
- **REQ-M10:** Hosted memory shard sync (`grok_bot_server_memories` gate): synchronize shards with a backend service; treated as optional hosted dependency.

#### 2.5.3 Memory API (Differentiator)
- **REQ-M11 (new):** The system MUST expose a Memory API allowing users to: list all memory entries, read a specific entry, update an entry, delete an entry.
- **REQ-M12 (new):** Each memory entry MUST include: scope, source (conversation ID + turn ID), timestamp, staleness window, and content.
- **REQ-M13 (new):** Deletion MUST propagate to all shards (agent, user, project) and must not require account deletion.

### 2.6 Multi-Bot System

#### 2.6.1 Peer Messaging
- **REQ-B01:** Each bot MUST have a message inbox with a priority partition.
- **REQ-B02:** `AgentToAgentMessaging.sendToAgent(targetBotId, message, priority)`: route to local bot or remote peer.
- **REQ-B03:** Peer wake prompt MUST identify sender as "another assistant", mark the message as asynchronous, and include batch sender identities and priority markings.
- **REQ-B04:** The `conservativeReplies` option MUST be available but defaults to `false` for box-hosted bots.
- **REQ-B05:** Peer message deduplication: maintain a bounded set of received message IDs (in-memory; v2 upgrades to durable).
- **REQ-B06:** Group posting MUST have separate membership checks from one-to-one priority delivery.

#### 2.6.2 Subagents
- **REQ-B07:** Task subagents: `requireServerSideSubagent: false`, `useClientSideSubagent: true` — subagents run in the same host process.
- **REQ-B08:** Subagent configuration MUST support: model override, type options, role-specific prompt, inherited parent lineage, reduced tool scope, reduced profile sections.
- **REQ-B09:** Runtime MUST track: subagent starts, stalls, steering events, cancellation, settlement, completion back to parent.
- **REQ-B10:** On completion, subagent MUST send a revival prompt to the parent with completion metadata and return context.
- **REQ-B11:** Reply-chain cycle detection: enforce hop budget (default: 5); reject messages exceeding the hop budget.

### 2.7 Storage Architecture

| Store | Implementation | Contents | Recovery |
|-------|---------------|----------|----------|
| `roster_db` | SQLite / Postgres | Bot identities, settings, group memberships | Must survive VM restart |
| `transcript_db` | SQLite / Postgres | Admission ledger, turn records, ack records | The displayed send ≠ durable persistence |
| `conversation_blobs` | Object storage (S3/local) | Binary conversation structure, root checkpoints, summary archives | Needed for full turn recovery |
| `memory_store` | SQLite / Postgres | Agent/user/project memory shards, synthesis evidence | Separate from blobs |
| `files_store` | VM filesystem + object storage backup | Bot profiles, skills, routine definitions | Separate from memory |
| `automation_store` | SQLite / Postgres | Routine definitions, cloud-sync shadow state, event queue | Remote schedules reconciled on sync |

- **REQ-S01:** The transcript mirror (shown in chat) and the native conversation structure (used for model context) MUST use different read paths.
- **REQ-S02:** `turn-settle` MUST: prepare transcript mirror → write agent checkpoint (blobs) → commit mirror with root ID. If checkpoint succeeds but transcript commit fails, `TranscriptAppendAfterCheckpointError` must be raised.
- **REQ-S03:** These three operations MUST NOT share a single database transaction (they can fail independently — design for reconciliation).
- **REQ-S04:** `SandSessionConversationState` MUST read transcript entries from `session.db` separately from `agentStore.getFullConversation`.

### 2.8 Inference Layer

#### 2.8.1 Provider Interface
- **REQ-I01:** The inference interface MUST be provider-agnostic: OpenAI-compatible, Anthropic, Google Gemini, and local (Ollama) must be swappable without changing the host.
- **REQ-I02:** Main inference session and summary inference session MUST use separate "purposes" (different session metadata; do not share session state).
- **REQ-I03:** Provider transport MUST preserve structured tool calls and results exactly (no lossy serialization).
- **REQ-I04:** Changing the model provider MUST leave all other hosted service calls (memory, identity, connectors) unchanged.

#### 2.8.2 Supported Models (v1.0 Target)
| Provider | Models |
|----------|--------|
| xAI | grok-4, grok-4.5, grok-3 |
| Anthropic | claude-opus-4, claude-sonnet-4 |
| OpenAI | gpt-4o, o3, o4-mini |
| Google | gemini-2.5-pro, gemini-2.5-flash |
| Local | any Ollama-compatible model |

#### 2.8.3 Multi-Agent / Parallel Inference
- **REQ-I05:** For "Heavy" tier equivalent: spawn up to N parallel inference instances per query, collect outputs, synthesize via debate-style merge (majority vote + LLM synthesis).
- **REQ-I06:** Token budget for parallel instances is N × single-instance budget; must gate behind explicit "Heavy mode" flag.

### 2.9 Tool Catalog

#### 2.9.1 Core Tools (Static Catalog)
| Tool | Description |
|------|-------------|
| `SendToUser` | Deliver a message to the user chat; can signal `end_turn` |
| `ReadFile` | Read a file from the VM filesystem |
| `WriteFile` | Write / overwrite a file |
| `AppendFile` | Append to a file |
| `DeleteFile` | Delete a file |
| `RunShell` | Execute a shell command on the VM; subject to approval |
| `BrowserNavigate` | Navigate browser to URL |
| `BrowserClick` | Click an element |
| `BrowserType` | Type text into an element |
| `BrowserScreenshot` | Capture the current page screenshot |
| `BrowserExtractContent` | Extract text / structured data from page |
| `BrowserScroll` | Scroll the page |
| `SearchWeb` | Web search (provider: Bing, Brave, or SerpAPI) |
| `FetchURL` | HTTP GET a URL and return content |
| `WriteMemory` | Write a fact to memory store (scope: agent/user/project) |
| `ReadMemory` | Read facts from memory store |
| `SendToAgent` | Send a message to another bot (local or remote) |
| `CreateSubagent` | Spawn a task subagent |
| `UpdateBotProfile` | Update bot name/profile text |
| `GetDynamicTools` | Discover available dynamic tools |
| `CallDynamicTool` | Call a discovered dynamic tool |
| `RequestApproval` | Pause turn and present approval UI to user |
| `SecureHandoff` | Return screen control to user for credential entry |
| `ReadTranscript` | Read conversation transcript (budget: 48,000 chars) |
| `ConnectorCall` | Call a built-in connector (Gmail, Calendar, etc.) |
| `MCPCall` | Call an MCP server tool |

#### 2.9.2 Tool Permission Levels
| Level | Description |
|-------|-------------|
| 0 - Always Allowed | Read-only VM operations (ReadFile, BrowserScreenshot) |
| 1 - Confirm First Time | Write operations with low risk |
| 2 - Always Confirm | Shell commands, file deletion, email send, calendar write |
| 3 - Secure Handoff Required | Credential entry, payment, 2FA |

### 2.10 Desktop Application

- **REQ-D01:** Electron-based desktop app for macOS (Apple Silicon + Intel) and Windows (x64 + ARM64).
- **REQ-D02:** Architecture: Renderer (React UI) ↔ Preload IPC ↔ Electron Main ↔ Local execution daemon.
- **REQ-D03:** The desktop app manages: account/gateway connection, OAuth connector flows, OS integration, optional local execution daemon.
- **REQ-D04:** The desktop app MUST communicate with the Box Host via authenticated WebSocket/HTTP2 gateway protocol.
- **REQ-D05:** Voice transcription (optional): read up to 16 pages × 256 entries of recent transcript for voice context.
- **REQ-D06:** The desktop app MUST show the bot roster, per-bot chat, routine status, memory viewer, connector status.
- **REQ-D07:** Screen sharing / remote control: show the VM's active browser screen in the desktop app (via VNC / WebRTC).

### 2.11 Automation / Routines System

- **REQ-R01:** Automation sync: local routine definitions MUST be reconciled with a cloud-hosted shadow schedule on startup.
- **REQ-R02:** `isBoxHostedForAutomationSync` flag MUST exclude session-only boxes from that reconciliation path.
- **REQ-R03:** Deleting a local routine definition file MUST NOT assume the remote shadow was deleted; explicit sync call required.
- **REQ-R04:** Routine event triggers MUST support: cron (POSIX cron expression), webhook (HTTP POST), connector event (e.g., `gmail.message.received`), inter-bot message, VM file change.
- **REQ-R05:** A test run MUST execute the full routine with real tools; UI MUST warn the user explicitly.

### 2.12 Security Requirements

- **REQ-SEC01:** All bot-to-host communication MUST be over TLS 1.3+.
- **REQ-SEC02:** Connector OAuth tokens MUST be stored encrypted at rest (AES-256-GCM).
- **REQ-SEC03:** Connector tokens MUST NEVER appear in model context, chat transcript, or log output.
- **REQ-SEC04:** `bot_secrets` prompt section MUST NOT log secret values; reference only by key name.
- **REQ-SEC05:** MCP server output MUST be treated as untrusted; prompt injection via MCP MUST be detected and flagged.
- **REQ-SEC06:** Shell command execution MUST run in a restricted user namespace (no root by default).
- **REQ-SEC07:** Cross-bot data isolation: project memory MUST require explicit bot membership; no implicit cross-bot data sharing beyond the VM filesystem and account-scoped connectors (by design, matching Grok Bot behavior).
- **REQ-SEC08:** Network egress policy: optional `getEgressPolicy(domains/CIDR/ports)` MUST be enforced via VM-level firewall rules.
- **REQ-SEC09:** Audit log: all tool executions with their machine target, timestamp, approval status, and outcome MUST be logged and retained for 90 days.

### 2.13 Performance Requirements

| Metric | Target |
|--------|--------|
| Time to first visible model token (P95) | < 2 seconds |
| Time to first complete reply (P95) | < 10 seconds |
| Context assembly time (P99) | < 200 ms |
| Checkpoint write latency (P95) | < 500 ms |
| VM cold start time | < 30 seconds |
| VM warm request routing | < 1 second |
| Browser page load (inside VM) | < 5 seconds (network-dependent) |
| Max parallel bots per account VM | 10 (configurable) |
| Max tool calls per turn | 100 (configurable) |
| Max turns per session | unlimited |
| Routine cron precision | ± 60 seconds |

### 2.14 Scalability Requirements

- **REQ-SCALE01:** Host process MUST support horizontal scaling; session state MUST be stored externally (Redis / Postgres), not in process memory.
- **REQ-SCALE02:** VM provisioning MUST be automated via a cloud provider API (AWS EC2, GCP Compute, or bare metal with libvirt).
- **REQ-SCALE03:** Blob store MUST be compatible with S3-compatible object storage.
- **REQ-SCALE04:** The gateway MUST support at least 10,000 concurrent WebSocket connections per host node.
- **REQ-SCALE05:** Inference requests MUST be load-balanced across multiple provider endpoints.

---

## 3. API Specifications

### 3.1 External REST API

```
POST   /v1/bots                    Create a new bot
GET    /v1/bots                    List all bots on account
GET    /v1/bots/{botId}            Get bot details
PATCH  /v1/bots/{botId}            Update bot profile/settings
DELETE /v1/bots/{botId}            Delete a bot

POST   /v1/bots/{botId}/messages   Send a message to a bot (turns)
GET    /v1/bots/{botId}/messages   Get chat transcript
DELETE /v1/bots/{botId}/runs/{id}  Cancel an active run

GET    /v1/bots/{botId}/memory     List memory entries
POST   /v1/bots/{botId}/memory     Create a memory entry
PATCH  /v1/bots/{botId}/memory/{id} Update a memory entry
DELETE /v1/bots/{botId}/memory/{id} Delete a memory entry

GET    /v1/skills                  List skills
POST   /v1/skills                  Create a skill
GET    /v1/skills/{skillId}        Get skill
PATCH  /v1/skills/{skillId}        Update skill
DELETE /v1/skills/{skillId}        Delete skill

GET    /v1/routines                List routines
POST   /v1/routines                Create a routine
PATCH  /v1/routines/{routineId}    Update routine
DELETE /v1/routines/{routineId}    Delete routine
POST   /v1/routines/{routineId}/test  Test run (real execution)

GET    /v1/connectors              List connected services
POST   /v1/connectors/{type}/auth  Start OAuth flow
DELETE /v1/connectors/{type}       Disconnect a connector

GET    /v1/vm/status               VM status (running/sleeping/starting)
POST   /v1/vm/wake                 Wake a sleeping VM
GET    /v1/vm/screen               WebRTC offer for VM screen sharing
```

### 3.2 WebSocket Gateway Protocol

```
Client → Server:
  { type: "sendPrompt", agentId, prompt, attachments, nonce }
  { type: "interrupt", agentId, runId }
  { type: "approve", agentId, runId, actionId, decision }

Server → Client:
  { type: "accepted", echoId, nonce }
  { type: "token", agentId, runId, delta }
  { type: "toolStart", agentId, runId, toolName, params }
  { type: "toolEnd", agentId, runId, toolName, result }
  { type: "approvalRequired", agentId, runId, actionId, actionDescription }
  { type: "message", agentId, runId, content, endTurn }
  { type: "settled", agentId, runId, usage }
  { type: "error", agentId, runId, code, message }
```

---

## 4. Technology Stack (Recommended)

| Layer | Technology |
|-------|-----------|
| Box Host | TypeScript + Bun (or Node.js 22) |
| Agent Framework | Custom (based on harness reverse-eng.) or LangGraph |
| Database | PostgreSQL 16 (primary) + Redis 7 (sessions/queues) |
| Blob Store | S3-compatible (MinIO for self-hosted) |
| VM Provisioning | Firecracker microVMs or Docker + Xpra |
| Browser Automation | Playwright (CDP) |
| Desktop App | Electron 32 + React 19 + Tailwind |
| Gateway Protocol | WebSocket over HTTP2 (ws + h2) |
| Auth | OAuth 2.0 PKCE (connectors) + JWT (user sessions) |
| Memory Encryption | libsodium (AES-256-GCM) |
| Inference Clients | Vercel AI SDK (multi-provider) |
| Self-hosted Infra | Docker Compose (dev) + Helm chart (prod) |
| Monitoring | OpenTelemetry → Prometheus + Grafana |
| CI/CD | GitHub Actions |

---

## 5. Data Models

### 5.1 Bot
```typescript
interface Bot {
  id: string;             // uuid
  accountId: string;      // owner account
  name: string;           // display name
  systemPrompt: string;   // base persona
  profileText: string;    // extended profile
  role: 'main' | 'peer' | 'subagent';
  skills: string[];       // skill IDs
  tools: string[];        // allowed tool IDs
  memorySettings: {
    agentScope: boolean;
    userScope: boolean;
    projectScope: boolean;
    projectId?: string;
  };
  approvalSettings: ApprovalPolicy;
  createdAt: Date;
  updatedAt: Date;
}
```

### 5.2 Turn (Conversation Unit)
```typescript
interface Turn {
  id: string;
  botId: string;
  runId: string;
  type: 'user' | 'peer' | 'routine' | 'wake';
  input: TurnInput;         // prompt + attachments + nonce
  state: 'pending' | 'running' | 'settled' | 'cancelled' | 'error';
  steps: Step[];
  checkpointRootId?: string;
  summaryArchiveId?: string;
  usage?: TokenUsage;
  createdAt: Date;
  settledAt?: Date;
}

interface Step {
  id: string;
  turnId: string;
  index: number;
  modelMessages: ModelMessage[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  checkpointBlobId?: string;
  createdAt: Date;
}
```

### 5.3 Memory Entry
```typescript
interface MemoryEntry {
  id: string;
  botId: string;
  accountId: string;
  scope: 'agent' | 'user' | 'project';
  projectId?: string;
  content: string;
  sourceConversationId: string;
  sourceTurnId: string;
  confidence: number;       // 0-1, synthesis confidence
  stalenessWindowDays: number;
  isUserAuthored: boolean;  // protected from auto-overwrite
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}
```

### 5.4 Skill
```typescript
interface Skill {
  id: string;
  accountId: string;
  name: string;
  description: string;
  steps: SkillStep[];       // natural language steps
  recordingTranscript?: string; // from browser demo recording
  approvalPoints: number[]; // step indices requiring approval
  errorHandling: ErrorPolicy;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### 5.5 Routine
```typescript
interface Routine {
  id: string;
  accountId: string;
  botId: string;
  skillId: string;
  name: string;
  trigger: RoutineTrigger;
  enabled: boolean;
  history: RoutineRun[];   // last 20
  createdAt: Date;
}

type RoutineTrigger =
  | { type: 'cron'; expression: string }
  | { type: 'webhook'; path: string }
  | { type: 'connector'; service: string; event: string }
  | { type: 'bot_message'; botId: string }
  | { type: 'file_change'; path: string };
```

---

## 6. Testing Requirements

- **REQ-TEST01:** Unit tests MUST cover: context assembly (all 6 section groups), compaction trigger and carrier construction, memory read/write/synthesis, tool routing by machineId, approval policy enforcement.
- **REQ-TEST02:** Integration tests MUST cover: full turn execution with mock model (assert step count, tool calls, checkpoint writes), routine trigger → execution → history logging, peer message delivery and wake.
- **REQ-TEST03:** End-to-end tests (using Playwright): bot creation → send message → view reply → verify memory extraction.
- **REQ-TEST04:** The eval entry point (`--eval-mode`) MUST be usable in CI without a live model or real account; it MUST accept a synthetic "ok" response fixture.
- **REQ-TEST05:** All connector OAuth flows MUST have mock server implementations for testing.

---

## 7. Open Questions / Unresolved (from Reverse Engineering)

| # | Question | Status |
|---|----------|--------|
| 1 | Exact desktop ↔ host pairing (e.g., desktop 0.52 ↔ host 17e335e) | Unresolved [U] |
| 2 | OS-level child process tree termination on cancel | Unresolved [U] |
| 3 | Provider-side context transformation, limits, auth renewal, billing classification | Unresolved [U] |
| 4 | In-memory peer queue durability across host restarts | Unresolved [U]; use Redis in our implementation |
| 5 | Complete summary adoption + restart behavior under failure | Unresolved [U]; requires stress testing |
| 6 | Memory API and enforced scope/isolation in hosted backend | Grok Bot: [U]; Our implementation: explicit API (REQ-M11–M13) |
| 7 | Provider-specific compaction (Anthropic, OpenAI, xAI) carrier format | Separate per-provider implementation required |
