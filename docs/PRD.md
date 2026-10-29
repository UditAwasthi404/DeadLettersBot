# Product Requirements Document (PRD)
## Grok Bot Clone — "AgentOS"

**Version:** 1.0  
**Date:** October 2026  
**Status:** Draft  
**Classification:** Internal

---

## 1. Executive Summary

AgentOS is an open-source, self-hostable clone of xAI's Grok Bot — a persistent cloud AI agent platform where users manage a roster of named, role-specific bots that share a single dedicated cloud computer. Unlike chat-based AI assistants, AgentOS bots can browse the web, read and write files, run terminal commands, connect to external services via connectors and MCP (Model Context Protocol) tools, and execute multi-step workflows autonomously — even when the user's device is offline.

The product is designed to be provider-agnostic, self-hostable, and MIT-licensed, giving teams full control over data, model choice, and deployment.

---

## 2. Problem Statement

### 2.1 Current Pain Points
- Existing AI chat assistants stop at ~90% task completion; they return drafts, not completed work inside business tools.
- Running multiple agent workflows requires fragmented tooling, separate authentication for every tool, and no persistent cross-session state.
- Cloud-only, closed-source agent platforms ($200/month) lack memory transparency, self-hosting, and model portability.
- Self-hosted alternatives (OpenClaw, Hermes Agent) require significant DevOps overhead and give no out-of-box "install and use" experience.

### 2.2 Opportunity
Build a system that:
- Assigns each user account one persistent cloud VM with a browser, filesystem, and terminal.
- Lets users create named bots with distinct roles on that shared machine.
- Provides built-in connectors (Gmail, Google Calendar, Outlook, Teams, Salesforce, etc.) that are authorized once and available to all bots.
- Supports Skills (reusable task instructions) and Routines (scheduled or event-triggered automation).
- Allows multiple bots to run in parallel, each on its own screen, and communicate with each other.
- Remains fully open-source, self-hostable, and model-agnostic.

---

## 3. Goals and Non-Goals

### 3.1 Goals
| Goal | Priority |
|------|----------|
| Persistent cloud VM per user account | P0 |
| Named multi-bot roster with role-based identities | P0 |
| Browser automation (web interaction without APIs) | P0 |
| File system and terminal access on the VM | P0 |
| Multi-step autonomous agent loop (think → act → observe) | P0 |
| Skills: reusable, teachable task instructions | P1 |
| Routines: scheduled and event-triggered automation | P1 |
| Built-in connectors (Gmail, Calendar, Drive, Outlook, Teams, SharePoint, Salesforce) | P1 |
| MCP (Model Context Protocol) tool support | P1 |
| Multi-bot coordination and inter-bot messaging | P1 |
| Memory: learned facts persisted across sessions | P1 |
| Approval/permission system (Allow Once / Deny / Always Allow) | P0 |
| Desktop app (macOS, Windows) + iOS companion | P2 |
| Self-hosting with Docker / Kubernetes | P1 |
| Model-agnostic inference (OpenAI, Anthropic, Gemini, local/Ollama) | P1 |
| Memory inspection, export, and correction | P1 (differentiator from Grok Bot) |
| Open source (MIT) | P0 |

### 3.2 Non-Goals (v1.0)
- Per-bot isolated VM (bots share one machine per account by design)
- Voice call interface (v2 roadmap)
- Mobile-first browser experience
- Native iOS/Android app (companion app only in v1)
- Proprietary closed model fine-tuning

---

## 4. Target Users

### Primary Personas

**1. The Delegate-and-Leave Professional**
- Wants to assign a task at end of day and review results in the morning.
- Needs: persistent cloud execution, multi-step autonomy, robust error recovery.

**2. The No-Code Business Automator**
- Wants to automate repetitive office workflows (email sorting, calendar management, CRM updates) without coding.
- Needs: conversational setup, built-in connectors, Skills and Routines, approval UI.

**3. The Developer / AI Builder**
- Wants to build, extend, or self-host an agent platform.
- Needs: open source code, MCP support, REST API, model choice, Docker deployment.

**4. The Privacy-Conscious Enterprise User**
- Cannot use closed-source cloud platforms for sensitive data.
- Needs: self-hosting, memory export, audit logs, granular permission controls.

---

## 5. User Stories

### 5.1 Core Agent Execution
- As a user, I can send a message to a named bot and have it complete a multi-step task using a browser, terminal, and files.
- As a user, I can close my laptop and the bot continues executing tasks on the cloud VM.
- As a user, I receive a notification when the bot completes a task or needs my approval to proceed.
- As a user, I can interrupt a running bot task at any time.

### 5.2 Bot Roster Management
- As a user, I can create multiple named bots (e.g., "Sales Bot", "Research Bot") with different personas and instructions.
- As a user, I can configure each bot with a system prompt, skill set, and tool access.
- As a user, I can have multiple bots run simultaneously on separate screens of the shared VM.
- As a user, I can designate one bot as a "Chief of Staff" that coordinates the others.

### 5.3 Skills and Routines
- As a user, I can teach a bot a skill by demonstrating a browser workflow (screen recording, up to 10 min).
- As a user, I can save a skill as reusable and assign it to multiple bots.
- As a user, I can create a routine that triggers a skill on a schedule or on an event (e.g., new email arrives).
- As a user, I have a limit of 50 active routines (matching Grok Bot), with 20 history items per routine.
- As a user, I understand that a routine test run performs real actions.

### 5.4 Connectors and MCP
- As a user, I can connect Gmail, Google Calendar, Google Drive, OneDrive, Outlook, Teams, SharePoint, and Salesforce — once — and all bots share these connections.
- As a user, I can connect custom MCP servers (publicly reachable or tunneled via ngrok/cloudflare).
- As a user, I can disconnect any connector and all associated session state is cleaned up.

### 5.5 Permissions and Approvals
- As a user, I can set "Allow Once", "Deny", or "Always Allow" for any sensitive action.
- As a user, I can create Auto Review rules that require human approval before certain action classes execute.
- As a user, sensitive credential entry (passwords, 2FA codes) is handled via a "Secure Handoff" where the bot returns control to me.
- As a user, I control whether bots can access my local computer (default: require approval every time).

### 5.6 Memory
- As a user, bots remember facts about me, my projects, and their own state across sessions.
- As a user, I can inspect what a bot remembers, correct it, and delete specific memories (differentiator).
- As a user, memory is structured and attributed (user facts, project facts, agent facts — with source and scope).

### 5.7 Multi-Bot Coordination
- As a user, bots can send messages to each other and coordinate work.
- As a user, I can see inter-bot communication in my chat transcript.
- As a user, a parent bot can spawn task subagents and receive their results.

---

## 6. Feature Specifications

### 6.1 Cloud VM (Execution Environment)
- One Linux cloud VM per user account (e.g., Ubuntu 22.04 LTS, 4 vCPU, 8 GB RAM, 50 GB SSD).
- Per-bot isolated screen sessions (via Xvfb or Xpra) on the shared VM.
- Browser: Chromium/Chrome with CDP (Chrome DevTools Protocol) for automation.
- Terminal: restricted bash with configurable sudo policies.
- File system: per-user home directory; cross-bot access by default (security boundary is per account, not per bot).
- VM persists between sessions; storage persists indefinitely until user deletion.

### 6.2 Agent Loop
The core loop per bot turn:
```
User Input → Context Assembly → Model Call → [Tool Call? → Execute → Append Result → Loop] → Final Reply → Memory Update → Checkpoint Save
```
- Maximum steps per turn: configurable (default 50).
- Turn = one accepted unit of user work.
- Step = one model + optional tool cycle.
- Checkpoint saved after every step for crash recovery.
- Conversation compaction (summarization) triggered on context overflow.

### 6.3 Skills
- A Skill is a structured instruction set: natural language steps + optional browser recording transcript.
- Skills can be created: (a) via text description, (b) via browser demonstration (screen recording → auto-transcribed to steps).
- Skills are stored per bot; can be shared to bot roster.
- Skills support: decision branches, error handling rules, approval insertion points.
- Skills are versioned; rollback is supported.

### 6.4 Routines
- A Routine = a Skill + a trigger (schedule or event).
- Trigger types: cron schedule, webhook event, connector event (e.g., new Gmail), inter-bot message, file change on VM.
- Limit: 50 active routines per account.
- Routines run in background lane; user-priority tasks can interrupt them.
- Routine history: last 20 runs logged (inputs, outputs, errors, duration).
- Deleting a routine is irreversible; data remains until garbage collected.

### 6.5 Connectors
Built-in connectors (OAuth 2.0):
| Service | Scopes |
|---------|--------|
| Gmail | read, send, labels, attachments |
| Google Calendar | read, write, free/busy |
| Google Drive | read, write, share |
| OneDrive | read, write |
| Outlook Mail | read, send |
| Outlook Calendar | read, write |
| Microsoft Teams | channels, messages, files |
| SharePoint | sites, lists, files |
| Salesforce | objects, records, reports |

MCP connector: add any MCP server URL + API key; must be publicly reachable (or tunneled).

### 6.6 Approval and Permission System
Three levels:
1. **Allow Once** — execute this specific instance; ask again next time.
2. **Deny** — block this instance.
3. **Always Allow** — never ask again for this action class.

Auto Review rules:
- Defined by admin / user: action class regex + mode (Require Approval | Always Allow).
- "Require Approval" takes precedence over "Always Allow" when both match.

Secure Handoff:
- Bot pauses and opens a "handoff screen" in the desktop app.
- User takes over the VM screen to type credentials, complete CAPTCHA, or authorize payment.
- Bot resumes after user signals completion.

Local PC execution:
- Off by default.
- Configurable: Always Require Approval | Always Allow | Never Allow.

### 6.7 Memory System
Three memory scopes:
- **Agent Memory**: facts specific to this bot.
- **User Memory**: facts about the user, shared across all bots.
- **Project Memory**: facts about a project (shared among bots with project membership).

Memory lifecycle:
1. After each turn: evidence extraction (LLM-assisted) captures potentially memorable facts from the exchange.
2. Synthesis step: proposes additions/updates with cited evidence; a verification pass reviews proposals.
3. Memory is written with source attribution, timestamp, and staleness window.
4. User can view, edit, and delete any memory entry via the UI (differentiator from Grok Bot).

Memory compaction: on context overflow, conversation is summarized; summary enters subsequent model context; original messages are archived.

### 6.8 Multi-Bot Messaging
- Each bot has an inbox (priority queue).
- SendToAgent call: routes message to local bot (same account) or remote peer (cross-account).
- Priority messages can interrupt a bot's current background lane work.
- Each message carries sender identity, text, optional attachments.
- Duplicate detection: in-memory Set of received message IDs (durability upgrade in v2).
- Bot reply chains: hop budget enforced (default: 5 hops) to prevent infinite loops.

---

## 7. Pricing Model (Reference Implementation)

| Tier | Price | Included |
|------|-------|----------|
| Free | $0/mo | 14-day trial with full features; then limited daily usage |
| Starter | $30/mo | 1 VM, 3 bots, 10 routines, 5 GB storage |
| Professional | $100/mo | 1 VM, 10 bots, 25 routines, 20 GB storage |
| Ultra | $200/mo | 1 VM, unlimited bots, 50 routines, 50 GB storage |
| Self-Hosted | $0 platform fee | Run on your own infra; your compute costs only |

Note: This is for the hosted SaaS variant. The open-source repo is free with no restrictions.

---

## 8. Success Metrics

| Metric | Target (6 months) |
|--------|-------------------|
| Task completion rate (multi-step agentic) | ≥ 80% |
| Mean time to first bot setup | < 5 minutes |
| Memory accuracy (user-reported "bot remembered correctly") | ≥ 90% |
| Routine execution success rate | ≥ 95% |
| P95 turn latency (first visible reply) | < 10 seconds |
| Security incident rate (unauthorized data access) | 0 |

---

## 9. Constraints and Risks

| Risk | Mitigation |
|------|-----------|
| VM costs at scale | Spot/preemptible instances; sleep VMs after inactivity |
| Model provider outage | Multi-provider fallback routing (Anthropic → OpenAI → local) |
| Bot infinite loop / runaway costs | Step budget, token budget, kill switch, circuit breaker |
| Sensitive data in shared VM | Clear offboarding docs; per-bot sandboxed directories (v2) |
| MCP server injection attacks | Treat MCP output as untrusted; prompt sanitization layer |
| Credential theft via chat | Strict Secure Handoff; no credential storage in chat history |

---

## 10. Roadmap

### v1.0 (MVP)
- Cloud VM provisioning per account
- Bot roster (create, name, configure)
- Core agent loop (browser, terminal, file tools)
- Memory (agent + user scope)
- Approval system
- Gmail + Google Calendar connectors
- Desktop app (Electron, macOS + Windows)

### v1.5
- Full connector suite (Outlook, Teams, SharePoint, Salesforce)
- Skills with browser recording ("Teach a task")
- Routines with cron + connector event triggers
- MCP server support
- Project memory scope
- Multi-bot messaging and coordination

### v2.0
- Per-bot sandboxed VM isolation option
- Voice interface
- Memory export API
- Per-bot security perimeter option
- Android app
- Federated multi-user team accounts
