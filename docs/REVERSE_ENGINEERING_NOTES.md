# Reverse Engineering Notes — Grok Bot Internals
## AgentOS Research Reference

**Date:** October 2026  
**Sources:** Public host 17e335e, Desktop 0.52–0.57.1, Runtime measurements  
**Note:** All source analysis is of emitted JavaScript, not original TypeScript. Certainty codes: **[S]** = source-confirmed, **[I]** = inferred, **[U]** = unresolved.

---

## 1. Source Artifacts Analyzed

| Artifact | SHA-256 | Notes |
|----------|---------|-------|
| `harness-0.52/host-main.cjs` (17e335e) | `f0e16cfa469d4b134735b020362d360aced9a3eaf729291c73f55111218cd1e4` | Primary host source |
| Desktop 0.52 | (captured) | Separate product; exact host pairing unproven [U] |
| Desktop 0.57.1 | (captured) | Includes gated task-list + SCM routing |
| `clamp-advertised-tools.js` | — | 333 bytes; initialization only; no active truncation |
| `clamp-direct-mcp-tools.js` | — | 668 bytes; initialization only; no active truncation |

Other recovered host versions (for changelog analysis): `.47`, `e6e1fb3`, `17e335e`, `95b13b6`, `d0de163`

---

## 2. Key Internal Identifiers

### 2.1 Core Classes and Functions

| Symbol | Role | Source |
|--------|------|--------|
| `SandHost` | Host orchestrator | H01 |
| `SandAgentRunner` | Per-agent turn shell | H08–H11 |
| `AnysphereAgent` | Native model-tool loop | H12 |
| `SandRunScheduler` | Per-agent 3-lane queue | H06/H07 |
| `createTurnRunShell` | Copies binary conv., creates sessions | H10 |
| `applyPostStepProcessing` | Post-step state update | H12 |
| `onStateUpdate` | State transition + checkpoint trigger | H12 |
| `afterStepCheckpoint` | Checkpoint persistence | H10/H13 |
| `checkpointChain` | Queued checkpoint callbacks | H10/H16 |
| `turn-settle` | Final state write + transcript mirror | H13/H15 |
| `assembleTurnAction` | User turn message builder | P02 |
| `createSystemPromptAssembly.renderSystemPrompt` | System prompt builder | P01 |
| `deferUserInfoCatalogRerender` | Deferred catalog update | H11/P03/P04 |
| `AgentToAgentMessaging` | Inter-bot messaging | B02 |
| `SandRunScheduler.enqueue` | Enqueue work by lane | H06/H07 |
| `runTurnMemory` | Post-turn memory extraction | M03/M06 |
| `MemoryService.createAgentStore` | Memory evidence recording | M02/M06 |
| `writeMemory → memoryShardFor` | Memory shard routing | M05 |
| `runSandEvalRequest → createSandEvalRunner` | Eval entry point | V01/V02 |
| `sendPromptOnce → recordPending, emitSendAck` | Admission + dedup | H05 |

### 2.2 Feature Gates (Runtime Feature Switches)

| Gate | Default (latest) | Effect |
|------|-----------------|--------|
| `stableDynamicToolCatalog` | `true` (from 95b13b6) | Dynamic tool offloading ON; only 10–11 static schemas sent |
| `sand_memory_dreaming` | Configurable | Background memory synthesis enabled |
| `grok_bot_server_memories` | Configurable | Hosted memory shard sync enabled |
| `reducePeerChatter` | `false` (box host) | Conservative peer reply mode OFF |
| `SAND_BOX_SESSION=1` | Env var | Disables one automation-sync path |
| `isBoxHostedForAutomationSync` | Per-session | Excludes session boxes from cloud reconciliation |

### 2.3 Internal Prompt Section Names

From `createSystemPromptAssembly`:
`base`, `spotlight`, `voice_channel`, `profile`, `user_identity`, `team_bot`, `multitask`, `internal_details_boundary`, `mcp_multi_account`, `user_form`, `draft_external_message`, `timezone`, `memory`, `current_session`, `active_sessions`, `automations`, `skills`, `stripe_link_purchasing`, `channels`, `agent_directory`, `group_chat_turns`, `mcp_instructions`, `mcp_status`, `remote_box`, `bot_secrets`, `computer`

### 2.4 Special Tool Names
- `SendToUser` — visible reply delivery + optional `end_turn`
- `GetDynamicTools` — discover available dynamic tools
- `CallDynamicTool` — invoke a discovered tool
- `ReadTranscript` — read conversation history (budget: 48,000 JS chars; bypassed by parts; measured max: 402,644 chars / 132,725 UTF-8 bytes in one message) **[S] 95b13b6+**

---

## 3. Runtime Measurements (Isolated Tests)

Measured on a synthetic `"."` twice conversation, private backend, no live model.

### 3.1 Request Size Comparison (.47 vs Latest)

| Boundary | .47 cold | Latest cold | .47 warm | Latest warm |
|----------|----------|-------------|----------|-------------|
| Main framed-protobuf (bytes) | 167,854 | 118,769 | 168,638 | 119,555 |
| Messages | 3 | 3 | 6 | 6 |
| Tool schemas | 40 | 11 | 40 | 11 |
| Decoded message JSON (bytes) | 49,811 | 59,056 | 50,914 | 60,189 |
| Decoded tool JSON (bytes) | 116,115 | 57,770 | 116,115 | 57,770 |
| Memory request (bytes) | 1,909 | 1,909 | 1,909 | 1,909 |

**Key finding:** Latest is ~28.8% smaller overall (two complete turns: 242,142 vs 340,310 bytes). Cause: dynamic tool offloading (40→11 upfront schemas). Not "everything got bigger."

### 3.2 Base Prompt Size by Version

| Host version | Full base (UTF-8 bytes) | Skillified base |
|-------------|------------------------|-----------------|
| .47 | 26,626 | 22,319 |
| e6e1fb3 | 28,255 | 23,887 |
| 17e335e | 28,409 | 24,041 |
| 95b13b6 | 30,165 | 25,652 |
| d0de163 | 30,192 | 25,679 |

Base grew ~13.4% across the full comparison. Latest two versions differ by only 27 bytes.

### 3.3 Dynamic Tool Offloading Experiment

Force-setting tool mode on same binary, same fixture:

| Mode | .47 cold main bytes / schemas | Latest cold main bytes / schemas |
|------|-------------------------------|----------------------------------|
| Static | 167,854 / 40 | 209,810 / 49 |
| Dynamic | 108,933 / 10 | 118,769 / 11 |

This confirms: offloading causes the reduction. Latest with static mode is actually 25% larger. The default flip to dynamic masks same-mode growth.

### 3.4 Compaction Size Impact

`XaiCompactionHandler.generateSummary` changes between `.47` and `e6e1fb3`:
- Old: small dedicated system message + no tools = **4,585 bytes JSON**
- New (e6e1fb3+): original system + catalog + compactor instructions appended as user message = **27,398 bytes JSON** (measured on synthetic 20 KB system + 10 schemas)

This is a ~6× increase in compaction request size. **Not** a real-world billing multiplier (history, caching, and handler vary).

---

## 4. Version Changelog (What Changed Per Version)

| First observed | Concrete changes |
|----------------|-----------------|
| .47 (baseline) | Parallel workers; post-turn memory extraction; stable prompt/schema gates; MCP discovery deadline; browser pre-warming; retry/continuation policies |
| e6e1fb3 | xAI compaction now includes original system/tools; summary/compaction wire tags; streamed-tool omission recovery; awaited rule refresh; browser readiness + stale-seat recovery; email review surface; image memoization |
| 17e335e | Conditional catalog deferral preserves earlier user-info prefix; appends changes as diff |
| 95b13b6 | Dynamic tools + stable catalog compiled defaults become `true`; `ReadTranscript` tool added; incoming provider ID/phase retention; forced-manual review can skip classification; failed-secret hidden wake; unsupported-image conversion option |
| d0de163 | Gated cloud watches; eligible voice-card copy inference; broader snapshot fallback; stronger delegation wording |
| Desktop .57.1 | Gated incremental task-list request; watch/task-card surfaces; conditional SCM routing |

**Important:** "First observed" = first capture containing the change, NOT a verified release/deployment date.

---

## 5. What the Architecture Trends Suggest

From analyzing the version deltas, xAI appears to be building toward:

1. **More persistent delegated agents** — better replay, cloud watches, task tracking, work resumed without typed message
2. **Dynamic context / tool loading** — reduces upfront context size, supports richer tool ecosystems
3. **More aggressive background execution** — post-output idle recovery, subagent fanout, voice card inference
4. **Better failure recovery** — streamed-tool omission recovery, stale-seat recovery, failed-secret wake queuing
5. **Multi-modal and multi-surface** — voice channel, image memoization, email surface, task cards

---

## 6. Unresolved Questions (Gaps in Reverse Engineering)

| # | Question | Why it matters |
|---|----------|----------------|
| 1 | Desktop 0.52 ↔ host 17e335e exact pairing | Compatibility of IPC protocol |
| 2 | OS child process tree kill on cancel | Safety: confirms no zombie processes |
| 3 | Provider-side context transforms, caching, billing | Cost estimation accuracy |
| 4 | In-memory peer queue durability across restarts | Message delivery guarantees |
| 5 | Complete summary adoption + restart under failure | Crash recovery correctness |
| 6 | Hosted memory backend API + enforced isolation | Security assessment |
| 7 | Provider-specific compaction carriers (Anthropic, OpenAI) | Must implement separately |
| 8 | Active MCP tool count cap (clamp scripts are init-only) | May exist in another module |
| 9 | Actual team-rule RPC timeout behavior under load | May cause blocking latency |

---

## 7. Evidence Table Index

Source IDs referenced in this document:

| ID | Component |
|----|-----------|
| H01–H03 | Host startup, auth, hosted control paths |
| H04–H05 | Gateway + send pipeline |
| H06–H07 | Run scheduler + lifecycle |
| H08–H11 | Host composition + runner |
| H12 | Native agent loop |
| H13–H15 | Checkpoint and transcript stores |
| H16 | checkpointChain callbacks |
| P01–P06 | Prompt assembly |
| T01–T05 | Tool dispatch, permissions, SendToUser |
| M01–M06 | Learned memory |
| C01–C05 | Compaction |
| B01–B05 | Multi-bot, subagents, peer messaging |
| I01–I06 | Inference extension + hosted identity |
| A01–A03 | Automation sync |
| V01–V02 | Eval entry point |
| S01–S04 | Session/conversation state |
| D01–D05 | Desktop-specific behavior |

---

## 8. Source Citations

- [Grok Bot Harness Architecture (gist)](https://gist.github.com/gfsaaser24/9f785c0c095b693b31b5efbcbae7bcd0) — Primary reverse engineering source by @gabefletcher; describes host 17e335e + desktop 0.52
- [Official Grok Bot Breakdown (vellum.ai)](https://www.vellum.ai/blog/official-grok-bot-breakdown) — Product feature breakdown, pricing, comparison
- [What Is Grok Bot (mindstudio.ai)](https://www.mindstudio.ai/blog/what-is-grok-bot) — Shared VM architecture, security model
- [Grok Bot Comprehensive Guide (note.com)](https://note.com/ai_driven/n/n2d0ace3afee5) — Skills/Routines deep dive, security boundaries, comparison table
- [xAI Multi-Agent Architecture (startuphub.ai)](https://www.startuphub.ai/ai-news/ai-figures/2026/figure-elon-musk-grok-multi-agent-architecture-2026-08-25) — Grok 4 Heavy 16-parallel-agent architecture
- [What's in Grok (lifearchitect.ai)](https://lifearchitect.ai/whats-in-grok/) — Model parameter estimates, training data analysis, Grok-0 through Grok-5 evolution

*Content was paraphrased and summarized for compliance with licensing restrictions.*
