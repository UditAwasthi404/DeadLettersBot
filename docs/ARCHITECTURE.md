# System Architecture Document
## Grok Bot Clone — "AgentOS"

**Version:** 1.0  
**Date:** October 2026  
**Companion:** PRD v1.0, TRD v1.0

---

## 1. Architecture Overview

AgentOS follows the same layered, event-driven architecture as Grok Bot host 17e335e, with three major improvements: self-hostability, memory transparency, and provider agnosticism. The system is split into four independently deployable tiers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Desktop / Mobile App                        │
│          (Electron + React | iOS Companion App)                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket / HTTP2 (TLS)
┌───────────────────────────▼─────────────────────────────────────┐
│                       Box Host (API Gateway)                    │
│   Auth → Send Pipeline → Run Scheduler → Agent Runner Loop      │
└──────┬────────────┬────────────────────┬────────────────────────┘
       │            │                    │
┌──────▼──┐  ┌──────▼──────┐   ┌────────▼─────────────────────┐
│ Storage │  │  Inference   │   │     Execution Environment      │
│  Layer  │  │  Layer       │   │  (Cloud VM per Account)        │
│(PG+S3+  │  │(xAI/OpenAI/  │   │  Browser | Terminal | FS      │
│ Redis)  │  │Anthropic/    │   │  Connectors | MCP Servers     │
└─────────┘  │Gemini/Ollama)│   └───────────────────────────────┘
             └─────────────┘
```

---

## 2. Component Architecture

### 2.1 Full Component Map

```
┌─────────────────────────────── Desktop App ───────────────────────────────────┐
│                                                                                 │
│  ┌─────────────────────┐  ┌────────────────────┐  ┌──────────────────────┐    │
│  │  Renderer (React)   │  │  Preload IPC /      │  │  Electron Main       │    │
│  │  - Chat UI          │  │  Coordinator        │  │  - Account Manager   │    │
│  │  - Bot Roster       │  │  - Command Router   │  │  - Gateway Client    │    │
│  │  - Permission UI    │  │  - Source/Roster    │  │  - OS Integration    │    │
│  │  - Memory Viewer    │  │    APIs             │  │  - Voice (optional)  │    │
│  │  - VM Screen (VNC)  │  │  - interruptAgent   │  │  - Network Routing   │    │
│  └──────────┬──────────┘  └──────────┬─────────┘  └──────────┬───────────┘    │
│             └─────────────────────────┴────────────────────────┘               │
│                                       │                                         │
│                       ┌──────────────▼──────────────┐                          │
│                       │    Local Execution Daemon    │                          │
│                       │  (runs tools on user's PC    │                          │
│                       │   when localMachineId used)  │                          │
│                       └─────────────────────────────┘                          │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │ WebSocket / HTTP2 Gateway Protocol
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│                                  Box Host                                        │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      Authenticated Gateway + Events                      │    │
│  │   sendPrompt() → validate → dedupe (nonce/hash) → echo → accept         │    │
│  └──────────────────────────────────┬──────────────────────────────────────┘    │
│                                     │                                            │
│  ┌──────────────────────────────────▼──────────────────────────────────────┐    │
│  │                     Transcript Manager + Admission                        │    │
│  │   Records accepted inputs; dispatches to Run Scheduler                   │    │
│  └──────────────────────────────────┬──────────────────────────────────────┘    │
│                                     │                                            │
│  ┌──────────────────────────────────▼──────────────────────────────────────┐    │
│  │                    Per-Agent Run Scheduler + Lifecycle                   │    │
│  │                                                                           │    │
│  │   ┌────────────┐  ┌─────────────┐  ┌───────────────────┐               │    │
│  │   │ User Lane  │  │ Agent Lane  │  │ Background Lane   │               │    │
│  │   │(user msgs) │  │(peer msgs)  │  │(routines/wakes)   │               │    │
│  │   └─────┬──────┘  └──────┬──────┘  └────────┬──────────┘               │    │
│  │         └────────────────┴──────────────────┘                           │    │
│  │                          │ enqueue                                       │    │
│  └──────────────────────────┬──────────────────────────────────────────────┘    │
│                             │                                                    │
│  ┌──────────────────────────▼──────────────────────────────────────────────┐    │
│  │              Host Composition + SandAgentRunner (Turn Shell)             │    │
│  │                                                                           │    │
│  │  createTurnRunShell():                                                   │    │
│  │    - copy binary conversation structure                                  │    │
│  │    - prepare profile updates                                             │    │
│  │    - create main inference session + summary session                     │    │
│  │    - call agent.runStream()                                              │    │
│  │    - after each step: append messages → onStateUpdate → checkpoint       │    │
│  │    - on settle: drain checkpoints → write blob → commit transcript       │    │
│  └──────────────────────────┬──────────────────────────────────────────────┘    │
│                             │                                                    │
│  ┌──────────────────────────▼──────────────────────────────────────────────┐    │
│  │                    Native Agent Loop (AnysphereAgent)                    │    │
│  │                                                                           │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │    │
│  │  │  Context Assembly                                                │    │    │
│  │  │  base → profile → memory → skills/automations → computer        │    │    │
│  │  │  + user_info (rules, catalogs) as separate message              │    │    │
│  │  │  + turn action message (user text + attachments + reminders)    │    │    │
│  │  └──────────────────────────────┬──────────────────────────────────┘    │    │
│  │                                 │                                        │    │
│  │  ┌──────────────────────────────▼──────────────────────────────────┐    │    │
│  │  │  Model Call (Inference Extension)                                │    │    │
│  │  │  → stream tokens → parse tool calls                             │    │    │
│  │  └──────────────────────────────┬──────────────────────────────────┘    │    │
│  │                                 │                                        │    │
│  │  ┌──────────────────────────────▼──────────────────────────────────┐    │    │
│  │  │  Tool Dispatch + Permission Adapter                              │    │    │
│  │  │  → resolve machineId → apply approval policy                    │    │    │
│  │  │  → route to: box daemon | local daemon | MCP | connector        │    │    │
│  │  └──────────────────────────────┬──────────────────────────────────┘    │    │
│  │                                 │                                        │    │
│  │  ┌──────────────────────────────▼──────────────────────────────────┐    │    │
│  │  │  Checkpoint + Post-Step Processing                               │    │    │
│  │  │  → onStateUpdate → afterStepCheckpoint → checkpointChain        │    │    │
│  │  └──────────────────────────────┬──────────────────────────────────┘    │    │
│  │                                 │                                        │    │
│  │  ┌──────────────────────────────▼──────────────────────────────────┐    │    │
│  │  │  Stop Condition Evaluation                                       │    │    │
│  │  │  step limit | no tools + no queue | cancel | end_turn           │    │    │
│  │  └──────────────────────────────┬──────────────────────────────────┘    │    │
│  │                                 │ (if not stopped → back to model call) │    │
│  └──────────────────────────────── ┼ ──────────────────────────────────────┘    │
│                                    │                                             │
│  ┌─────────────────────────────────▼───────────────────────────────────────┐    │
│  │                         Memory Extraction                                │    │
│  │  recordMemoryEvidence | legacy extraction | background synthesis         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Control Flow Diagrams

### 3.1 User Turn + Model/Tool Loop

```
User sends message
        │
        ▼
Gateway.sendPrompt(prompt, attachments, nonce)
        │
        ▼
Send Pipeline: validate → dedupe → echo → accept (separate from durable write)
        │
        ▼
Run Scheduler: enqueue on user lane
        │
        ▼
createTurnRunShell():
  - Copy binary conversation structure
  - Load bot profile + pinned prompt sections
  - Create main session + summary session
        │
        ▼
Context Assembly (renderSystemPrompt):
  [base] → [profile] → [memory] → [skills] → [computer]
  + user_info message (rules, catalogs, tool schemas)
  + assembleTurnAction() for user message
        │
        ▼
Agent.runStream()  ─────────────────────────────────────────┐
        │                                                    │
        ▼                                                    │
Model Call (streamed)                                        │
        │                                                    │
        ▼                                                    │
Tool calls in response?                                      │
   YES ─┐                                                    │
        ▼                                                    │
   Resolve tool → apply machineId routing                    │
        │                                                    │
        ▼                                                    │
   Permission check (Allow/Deny/Approval Required)           │
        │                                                    │
        ▼                                                    │
   Execute tool (box daemon | local daemon | MCP | connector)│
        │                                                    │
        ▼                                                    │
   Append tool result to history                             │
        │                                                    │
        ▼                                                    │
   afterStepCheckpoint() → checkpointChain.persist()         │
        │                                                    │
        ▼                                                    │
   More work? (step limit / no tools / cancel?) ────NO──────►│ settle
        │ YES                                                 │
        └────────────────────────────────────────────────────┘
   NO tool calls
        │
        ▼
   afterStepCheckpoint()
        │
        ▼
   Stop condition → settle
        │
        ▼
turn-settle():
  prepareCheckpoint → writeAgentCheckpoint (blob) → commitTranscriptMirror
        │
        ▼
Memory extraction:
  recordMemoryEvidence() or legacyExtraction()
        │
        ▼
Background synthesis (if gate enabled):
  propose changes → verify → apply (with optimistic concurrency)
        │
        ▼
Conditional follow-on events:
  cloud watches | voice card inference | email classification
```

### 3.2 Context Assembly Detail

```
createSystemPromptAssembly.renderSystemPrompt():

PINNED (stable until next compaction epoch):
  1. base           ← persona, capabilities, stop policy
  2. profile        ← bot name, role, profile text
  3. memory         ← user facts, project facts, agent facts
  4. skills         ← available skill descriptions
  5. computer       ← VM environment description

LIVE (refreshed each turn as notes):
  - Profile changes → appended as update note in assembleTurnAction()
  - Memory changes  → arrive as note, then pinned after compaction
  - Catalog changes → sent as diff via deferUserInfoCatalogRerender()

SECTION HASHING:
  - Each section has a SHA hash stored
  - If hash unchanged → provider can cache prefix (reduces latency + cost)
  - If hash changed and section is pinned → send change note this turn,
    fold into pin at next compaction

USER_INFO MESSAGE (separate, before history):
  - Rules, skills catalog, tool schemas
  - Dynamic tool offloading (default ON): only 10–11 static schemas sent up front
  - Full tool catalog available via GetDynamicTools/CallDynamicTool
```

### 3.3 Compaction Flow

```
Context approaches overflow threshold
        │
        ▼
Trigger summarization:
  mode: background (doesn't block turn) | foreground (blocks)
        │
        ▼
Check for pending summary candidate:
  Is original message prefix still current? → YES: use candidate
                                             → NO: generate new
        │
        ▼
Generate summary (one of three strategies):
  A. Generic self-summary:
     send [system + user_info prefix + history + "summarize" request]
     → summary enters next context as user-role message
  B. External summarizer:
     similar; uses isSummary=true tag
  C. Provider-specific (xAI/Anthropic/OpenAI):
     separate implementations; include original system + tools
        │
        ▼
On valid summary:
  - Write summary carrier message
  - Archive original conversation to blob store
  - Advance compaction epoch (frozen prefix refreshed)
  - Next model context: [pinned sections + summary carrier + latest user query]
        │
        ▼
On failed summary:
  - MUST preserve original context (hard requirement)
  - Retry or fall back to smaller window
```

### 3.4 Multi-Bot Coordination Flow

```
Bot A sends message to Bot B:
  SendToAgent(targetBotId: "bot-b", text, priority: true)
        │
        ▼
AgentToAgentMessaging.sendToAgent():
  - Target local? → route to local inbox
  - Target remote? → route via hosted remote-agent messaging client
        │
        ▼
Bot B's inbox (priority queue):
  - Priority message: can interrupt background lane
  - Dedup check: is receivedId in Set?
  - Batch: collect queued messages
        │
        ▼
Bot B wakes (queueInboundAndWake):
  - Wake prompt: "You have a message from Bot A (another assistant)..."
  - Message arrives asynchronously and is visible in chat
  - Priority marking: "action expected sooner"
        │
        ▼
Bot B runs turn, produces result, calls SendToAgent back to A
        │
        ▼
Bot A revival:
  settleBackgroundSubagentTurn() → send revival prompt with
  completion metadata + return context to parent
```

### 3.5 Memory Synthesis Flow

```
End of turn → runTurnMemory()
        │
        ▼
recordMemoryEvidence available?
  YES → record exchange, clear pending episode turns, done
  NO  → legacy extraction path:
          - record episode turns
          - generate episode narrative (optional)
          - extraction model call: given relevant existing facts + exchange,
            return JSON of changes (add/update/delete)
          - parse + apply changes
        │
        ▼
Background synthesis (sand_memory_dreaming gate):
  - MemoryService.createAgentStore records evidence
  - Synthesis session (separate labeling-skipped summarization session):
      1. Propose changes with cited evidence
      2. Verification model pass: check schemas, evidence references
      3. Apply changes against saved snapshot
      4. Stale snapshot? → retry pass
        │
        ▼
Memory written with:
  { content, scope, sourceConversationId, sourceTurnId,
    confidence, stalenessWindowDays, isUserAuthored }
```

---

## 4. Storage Layer Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Storage Layer                                 │
│                                                                       │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐  │
│  │  PostgreSQL (primary) │  │  Redis (sessions + queues)           │  │
│  │                       │  │                                      │  │
│  │  Tables:              │  │  Keys:                               │  │
│  │  - accounts           │  │  - session:{accountId}               │  │
│  │  - bots               │  │  - run:{runId}:state                 │  │
│  │  - turns              │  │  - inbox:{botId}:priority            │  │
│  │  - steps              │  │  - inbox:{botId}:normal              │  │
│  │  - memory_entries     │  │  - inbox:{botId}:dedup               │  │
│  │  - skills             │  │  - checkpoint_chain:{runId}          │  │
│  │  - routines           │  │  - automation_queue:{accountId}      │  │
│  │  - routine_runs       │  │                                      │  │
│  │  - connectors         │  └──────────────────────────────────────┘  │
│  │  - audit_log          │                                             │
│  │  - projects           │  ┌──────────────────────────────────────┐  │
│  │  - roster             │  │  S3-Compatible Blob Store            │  │
│  │  - admission_ledger   │  │  (MinIO for self-hosted)             │  │
│  └──────────────────────┘  │                                      │  │
│                             │  Buckets:                            │  │
│                             │  - conversation-blobs/               │  │
│                             │    {accountId}/{botId}/{turnId}/     │  │
│                             │    root.bin                          │  │
│                             │  - summary-archives/                 │  │
│                             │  - skill-recordings/                 │  │
│                             │  - vm-snapshots/                     │  │
│                             └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

STATE DOMAIN ISOLATION (critical for recovery):
  - transcript_db (admission + turn records) ≠ conversation_blobs
  - memory_store ≠ conversation_blobs
  - routine_definitions ≠ active_run_state
  - These NEVER share a single DB transaction; reconciliation is explicit.
```

---

## 5. VM / Execution Environment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│              Account-Scoped Cloud VM (per user account)              │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Host OS (Ubuntu 22.04 LTS)                                    │ │
│  │                                                                 │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │ │
│  │  │  Bot A        │  │  Bot B        │  │  Bot C               │ │ │
│  │  │  Screen       │  │  Screen       │  │  Screen              │ │ │
│  │  │  (Xvfb :1)   │  │  (Xvfb :2)   │  │  (Xvfb :3)           │ │ │
│  │  │              │  │              │  │                      │ │ │
│  │  │  Chromium    │  │  Chromium    │  │  Chromium            │ │ │
│  │  │  (CDP port   │  │  (CDP port   │  │  (CDP port           │ │ │
│  │  │   9222)      │  │   9223)      │  │   9224)              │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘ │ │
│  │                                                                 │ │
│  │  SHARED ACROSS ALL BOTS:                                       │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  Filesystem: /home/agent/                               │  │ │
│  │  │  - /home/agent/shared/   ← cross-bot shared files      │  │ │
│  │  │  - /home/agent/bots/{botId}/  ← per-bot working dir    │  │ │
│  │  │  (No hard isolation by design — matches Grok Bot)       │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  Execution Daemon (box-host-side)                       │  │ │
│  │  │  - Receives tool calls via loopback socket              │  │ │
│  │  │  - Executes: shell, file ops, browser CDP calls        │  │ │
│  │  │  - Child process management + cancellation             │  │ │
│  │  │  - Window router: routes by screen/botId               │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  Connector Sessions (shared, once-authorized)           │  │ │
│  │  │  - Gmail OAuth token                                    │  │ │
│  │  │  - Google Calendar OAuth token                          │  │ │
│  │  │  - Outlook OAuth token                                  │  │ │
│  │  │  - Salesforce OAuth token                               │  │ │
│  │  │  - ... (all connectors)                                 │  │ │
│  │  │  All bots share these sessions (by design)              │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  MCP Server Connections                                 │  │ │
│  │  │  - Outbound connections to user-configured MCP servers  │  │ │
│  │  │  - Must be publicly reachable (or ngrok/cloudflare)     │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │  VM Screen Access (for user):                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  VNC Server + WebRTC relay → Desktop App screen view    │  │ │
│  │  │  Secure Handoff: user takes control via VNC in app      │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘

VM LIFECYCLE:
  Active    → Processing a turn
  Idle      → No active turn (10 min timeout → sleep)
  Sleeping  → Suspended; wake on next message (< 30s cold start)
  Terminated → Account deletion; data wiped
```

---

## 6. Inference Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Inference Extension                           │
│                                                                      │
│  createMainSession(botId, purpose: 'main'):                         │
│    - select provider from account config or fallback chain          │
│    - create provider client (xAI | OpenAI | Anthropic | Gemini |   │
│                               Ollama)                               │
│    - return session handle                                          │
│                                                                     │
│  createSummarySession(botId, purpose: 'summarization'):             │
│    - separate session, separate purpose metadata                    │
│    - may use different model (cheaper)                              │
│    - labeling hooks skipped                                         │
│                                                                     │
│  Provider Fallback Chain (configurable):                            │
│    primary → secondary → tertiary → local (Ollama)                 │
│    Triggers: rate limit, timeout, provider error                    │
│                                                                     │
│  Parallel Inference (Heavy Mode):                                   │
│    - Spawn N sessions (default: 4, max: 16) for same query         │
│    - Each reasons independently (extended thinking)                 │
│    - Collect outputs → debate-style synthesis model call           │
│    - Return single merged answer                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Skill and Routine Engine Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Skills Engine                                 │
│                                                                      │
│  Skill Creation Paths:                                              │
│  A. Text Description → parse into SkillStep[] → store              │
│  B. Browser Recording (up to 10 min):                              │
│       record → extract CDP event log → LLM transcription           │
│       → draft SkillStep[] → user review → store                    │
│       (microphone NOT recorded)                                     │
│                                                                     │
│  Skill Execution:                                                   │
│    botId + skillId → inject skill steps into system prompt         │
│    → model follows steps as instructions                           │
│    → approval points pause execution and call RequestApproval()    │
│    → error handling rules in skill definition                       │
│                                                                     │
│  Skill Storage:                                                     │
│    skills/{accountId}/{skillId}/v{N}.json                          │
│    (versioned, rollback supported)                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        Routines Engine                               │
│                                                                      │
│  Routine Trigger → queue on background lane → SandAgentRunner      │
│                                                                      │
│  Trigger Types:                                                     │
│   cron     → scheduler ticks (± 60s precision)                     │
│   webhook  → HTTP POST to /v1/webhooks/{routineId}                 │
│   connector→ connector event polling / push                        │
│   bot_msg  → inter-bot message delivery                            │
│   file     → inotify on VM filesystem path                         │
│                                                                     │
│  Automation Sync:                                                   │
│    local definitions ↔ cloud shadow schedules                      │
│    reconciled on startup + periodic sync                           │
│    session-box flag excludes from hosted sync path                 │
│                                                                     │
│  History: last 20 runs per routine                                 │
│    { triggeredAt, status, duration, inputSummary, outputSummary,  │
│      errorMessage }                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Approval and Permission System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Permission + Approval System                      │
│                                                                      │
│  Per-Action Decision (in-flight):                                   │
│   Allow Once   → execute; ask again next invocation                │
│   Deny         → block; log; return error to model                 │
│   Always Allow → execute without asking; stored in policy          │
│                                                                     │
│  Auto Review Rules (pre-configured by user):                       │
│   Rule: { actionPattern: regex, mode: 'require' | 'always_allow' }│
│   Precedence: 'require' wins over 'always_allow' when both match   │
│   Evaluated before tool execution                                   │
│                                                                     │
│  Permission Levels (per tool):                                      │
│   Level 0 - no approval needed                                     │
│   Level 1 - confirm first time                                     │
│   Level 2 - always confirm (default for shell, write, send)       │
│   Level 3 - Secure Handoff (credentials, payment, 2FA)            │
│                                                                     │
│  Secure Handoff Flow:                                               │
│   1. Bot calls SecureHandoff(reason)                               │
│   2. Host pauses turn; sends approval_required event to desktop    │
│   3. Desktop shows "Take Control" screen (opens VNC session)       │
│   4. User types credentials / completes action                     │
│   5. User clicks "Return to Bot"                                   │
│   6. Host resumes turn from checkpoint                             │
│                                                                     │
│  Local PC Execution:                                               │
│   Default: require approval every time                             │
│   Options: always approve | always deny                            │
│   Routed via localMachineId → Desktop Local Daemon                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. Gateway Protocol Details

```
WebSocket frame types (client → server):

sendPrompt:
  {
    type: "sendPrompt",
    agentId: string,
    prompt: string,
    attachments: Attachment[],
    nonce: string,           // dedup key
    routingOptions?: {
      machineId?: string,    // explicit routing
      priority?: boolean
    }
  }

interrupt:
  { type: "interrupt", agentId: string, runId: string }

approve:
  { type: "approve", agentId: string, runId: string,
    actionId: string, decision: "allow_once" | "deny" | "always_allow" }

WebSocket frame types (server → client):

accepted:    { type: "accepted", echoId, nonce }
             NOTE: accepted ≠ durably written
token:       { type: "token", agentId, runId, delta: string }
toolStart:   { type: "toolStart", agentId, runId, toolName, params }
toolEnd:     { type: "toolEnd", agentId, runId, toolName, result }
needsApproval: { type: "needsApproval", agentId, runId, actionId,
                  actionDescription, permissionLevel }
message:     { type: "message", agentId, runId, content, endTurn: bool }
settled:     { type: "settled", agentId, runId, usage: TokenUsage }
error:       { type: "error", agentId, runId, code, message }
vmScreen:    { type: "vmScreen", agentId, botId, webrtcOffer }
```

---

## 10. Startup Sequence

```
runHostMain():
  1. Acquire process lock (prevent duplicate hosts)
  2. Initialize environment + crash handler
  3. Start SandHost.start()

SandHost.start() — extension startup in dependency order:
  1.  Auth service + credential readiness
        - Check for access token (or mock mode)
        - Inference readiness check
  2.  Store initialization
        - PostgreSQL connection + migrations
        - Redis connection
        - Blob store client
  3.  Session recovery
        - Read in-progress turns from transcript_db
        - Resume ownership for turns in 'running' state
  4.  Runner composition
        - Bind profile stores, inference, tool adapters, permissions, MCP
        - createRunner() for each recovered turn
  5.  Gateway start
        - Authenticate WebSocket gateway
        - Register event bridges
  6.  Identity registration
        - noteAgentMinted() for each bot
        - Run backfill if sweep marker > 24h old
        - Group adoption + room migration (hosted service calls)
  7.  Automation sync
        - Reconcile local routine definitions with cloud shadow schedules
        - Start cron scheduler
        - Start connector event polling
  8.  Capabilities registration
  9.  Telemetry (OpenTelemetry exporter)
  10. Ready — begin accepting connections
```

---

## 11. Cancellation Flow

```
User clicks interrupt in UI
        │
        ▼
Desktop: interruptAgentRun(agentId, sessionId) → IPC → Electron Main
        │
        ▼
Gateway: interrupt message → Run Lifecycle → cancel signal
        │
        ▼
Runner: set cancellation flag on active run
        │
        ├──► Inference stream: abort() on active request context
        │
        ├──► Active tool context: cancel tool execution
        │       │
        │       ▼
        │    Window Router: destroy upstream request if caller disconnects
        │       │
        │       ▼
        │    Execution Daemon: cancel ControlledExec child context
        │       │
        │       ▼
        │    OS: SIGTERM to child process group (then SIGKILL after timeout)
        │
        └──► Checkpoint: drain checkpoints → settle with cancelled state
                 │
                 ▼
             Transcript mirror: committed with cancelled flag
```

---

## 12. Deployment Architecture

### 12.1 Docker Compose (Self-Hosted Development)

```yaml
services:
  box-host:        # Box Host + Agent Runtime
  postgres:        # Primary database
  redis:           # Session state + queues
  minio:           # S3-compatible blob store
  vm-manager:      # VM provisioning (Firecracker/Docker-in-Docker)
  desktop:         # Optional: served Electron app (dev only)
  gateway-proxy:   # nginx reverse proxy + TLS termination
```

### 12.2 Kubernetes (Production)

```
Namespace: agentOS

Deployments:
  box-host          replicas: 3 (HPA: CPU + WebSocket connections)
  vm-manager        replicas: 2
  gateway-proxy     replicas: 2

StatefulSets:
  postgres          replicas: 1 primary + 2 replicas
  redis             replicas: 1 primary + 1 replica

Jobs / CronJobs:
  db-migrations
  vm-gc             (garbage-collect sleeping VMs)
  memory-synthesis  (background synthesis worker)

Storage:
  PVC for postgres, redis, VM disk images
  S3 for blob store (external or MinIO)

Ingress:
  HTTPS + WSS via nginx-ingress
  TLS via cert-manager (Let's Encrypt)
```

### 12.3 Scaling Strategy

```
Bottleneck          Strategy
────────────────    ──────────────────────────────────────────────
Box Host CPU        Horizontal scale; session state in Redis
VM Count            VM pool pre-warming; sleep on inactivity
Inference Tokens    Provider load balancing; fallback chain
DB Write Pressure   Async checkpoint writes; WAL tuning
Blob Store          S3 (external); no horizontal limit
WebSocket Conns     10k/node; scale-out behind load balancer
```

---

## 13. Security Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Security Layers                               │
│                                                                      │
│  Transport:                                                         │
│    TLS 1.3+ everywhere                                              │
│    Certificate pinning in desktop app                               │
│                                                                      │
│  Authentication:                                                    │
│    User sessions: JWT (RS256, 24h expiry)                          │
│    Bot-to-host: pre-shared secret per session                      │
│    Connector tokens: OAuth 2.0, stored encrypted (AES-256-GCM)    │
│                                                                      │
│  VM Isolation:                                                      │
│    Each account's VM is a separate Linux process namespace          │
│    Network namespace: egress filtered by policy                     │
│    No root access by default for bot shell commands                 │
│    Xvfb screens isolated per bot (display number)                  │
│                                                                      │
│  Prompt Injection Defense:                                          │
│    MCP output marked as untrusted in model context                 │
│    Fetched web content: sanitized, marked as external data         │
│    System_reminder tags: do NOT change API role                    │
│    Tool output: never elevates to system prompt authority          │
│                                                                      │
│  Audit Log:                                                         │
│    All tool executions logged: tool, params hash, machine,         │
│    approval_status, outcome, timestamp                              │
│    Retention: 90 days                                               │
│    Immutable: append-only table                                     │
│                                                                      │
│  Data Residency:                                                    │
│    Self-hosted: runs entirely on operator's infra                  │
│    Hosted SaaS: data in account's region                           │
│    Memory export API: user can dump all memories as JSON           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 14. Key Differences from Grok Bot (Design Improvements)

| Feature | Grok Bot | AgentOS |
|---------|----------|---------|
| Self-hosting | ❌ Not possible | ✅ Docker Compose + Helm |
| Memory inspection | ❌ Not exposed | ✅ Full CRUD API + UI |
| Model choice | ❌ xAI only | ✅ Any provider + local Ollama |
| Open source | ❌ Proprietary | ✅ MIT License |
| Memory export | ❌ Not documented | ✅ JSON export endpoint |
| Privacy mode | ❌ Not supported | ✅ Configurable data retention |
| Communication channels | Desktop + iPhone only | Desktop + iOS + API + Webhook |
| Per-bot isolation | ❌ Shared VM (by design) | Same by default + opt-in sandbox (v2) |
| Pricing | $200/mo standalone | Free (self-hosted) + paid tiers |
| Connector auth scope | Account-wide (shared) | Same (by design, documented clearly) |
| Audit log | Not documented | ✅ 90-day audit trail |
