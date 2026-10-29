# AgentOS — Open-Source Grok Bot Clone
## Documentation Index

This folder contains the complete engineering documentation for **AgentOS**, an open-source, self-hostable clone of xAI's Grok Bot. The documentation is based on reverse-engineering of the Grok Bot harness (public host 17e335e, desktop 0.52–0.57.1), public xAI disclosures, independent runtime measurements, and comparative analysis with similar agent platforms.

---

## Documents

| Document | Purpose |
|----------|---------|
| [PRD.md](./PRD.md) | **Product Requirements Document** — What we're building and why. User stories, feature specs, pricing, success metrics, and roadmap. |
| [TRD.md](./TRD.md) | **Technical Requirements Document** — Precise technical requirements for every system component, derived from reverse-engineered Grok Bot internals. API specs, data models, performance targets. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | **System Architecture** — Full component map, control flow diagrams, storage layer, VM/execution environment, inference layer, deployment topology, security architecture. |
| [AGENTS.md](./AGENTS.md) | **Agents Specification** — All 4 agent types (MainBot, PeerBot, TaskSubagent, RoutineAgent): roles, prompt composition, tool access, lifecycle, inter-agent communication, security model. |
| [BUILD_PLAN.md](./BUILD_PLAN.md) | **Build Plan** — 24-week, 4-phase implementation plan. Week-by-week tasks, monorepo structure, dependency graph, test strategy, risk register, milestones. |
| [REVERSE_ENGINEERING_NOTES.md](./REVERSE_ENGINEERING_NOTES.md) | **Reverse Engineering Notes** — Raw findings from source analysis of Grok Bot harness: internal class names, feature gates, runtime measurements, version changelog, unresolved questions. |

---

## What is Grok Bot?

Grok Bot (xAI, launched August 11, 2026) is a persistent cloud AI agent platform. Instead of a chat window, users get a dedicated cloud computer with:
- A browser, filesystem, and terminal
- A roster of named, role-specific bots that share this computer
- Skills (reusable task instructions) and Routines (scheduled automation)
- Built-in connectors (Gmail, Google Calendar, Outlook, Teams, Salesforce, etc.)
- MCP (Model Context Protocol) tool support
- Inter-bot coordination and subagent spawning

Bots run autonomously even when the user's device is offline. The key differentiator from chat AI is task completion **inside** business tools, not just drafting responses.

---

## What AgentOS Improves Over Grok Bot

| Feature | Grok Bot | AgentOS |
|---------|----------|---------|
| Self-hosting | ❌ | ✅ Docker + Kubernetes |
| Open source | ❌ Proprietary | ✅ MIT License |
| Model choice | ❌ xAI only | ✅ Any provider + local Ollama |
| Memory inspection | ❌ No API | ✅ Full CRUD + UI |
| Memory export | ❌ Not documented | ✅ JSON export |
| Pricing | $200/month | Free (self-hosted) |
| Privacy mode | ❌ Not supported | ✅ Configurable |
| Audit log | ❌ Not documented | ✅ 90-day immutable log |

---

## Architecture Summary

```
Desktop App (Electron)
       │ WebSocket / HTTP2
Box Host (Node.js/Bun)
  ├── Gateway (auth + dedup + admission)
  ├── Run Scheduler (3-lane queue per bot)
  ├── Agent Runner (turn shell + step loop)
  │     ├── Context Assembly (6-group system prompt)
  │     ├── Inference Extension (multi-provider)
  │     ├── Tool Dispatch (box | local | MCP | connector)
  │     └── Memory Extraction + Synthesis
  └── Storage (PostgreSQL + Redis + S3)
       │
Cloud VM (per account)
  ├── Per-bot Xvfb screens
  ├── Chromium (CDP automation)
  ├── Shell + Filesystem
  └── Connector sessions (shared)
```

---

## Key Technical Facts (from Reverse Engineering)

1. **Turn vs Step**: A "turn" is one user interaction. A "step" is one model+tool cycle. A turn can have many steps.
2. **Checkpoint after every step**: State is saved after each model+tool cycle for crash recovery.
3. **Separate state stores**: transcript mirror ≠ conversation blobs ≠ memory — never share a transaction.
4. **Dynamic tool offloading** (default ON since 95b13b6): Only 10–11 tool schemas sent upfront; full catalog available via GetDynamicTools/CallDynamicTool. This makes the latest Grok Bot ~28.8% smaller per request despite a larger system prompt.
5. **Pinned prompt prefix**: Sections 1–3 of the system prompt are frozen between compaction epochs to maximize provider prompt cache hits.
6. **Compaction changed in e6e1fb3**: xAI's compaction now sends the full original system + tool catalog, growing compaction requests ~6× but providing better summary continuity.
7. **Memory is extracted after every turn**: Post-turn memory extraction runs after the visible reply, before native settlement. It's hidden work that already existed in .47.
8. **Multiple bots share one VM** (by design, not a limitation): This is the security model — one perimeter, shared connectors. Bot separation is UX, not isolation.
9. **Priority peer messages can interrupt background routines**: The 3-lane scheduler gives user messages priority over background automation.
10. **Grok 4 Heavy** uses up to 16 parallel inference instances per query with debate-style synthesis — the architecture that scored above 40% on Humanity's Last Exam.

---

## Implementation Plan

See [PRD.md](./PRD.md) Section 10 (Roadmap) for the phased implementation plan.

**v1.0 MVP:** Cloud VM per account, bot roster, core agent loop (browser + terminal + file tools), memory, approval system, Gmail + Google Calendar connectors, Electron desktop app.

**v1.5:** Full connector suite, Skills with browser recording, Routines, MCP support, project memory, multi-bot coordination.

**v2.0:** Per-bot sandboxed VM option, voice interface, Memory export API, team accounts.
