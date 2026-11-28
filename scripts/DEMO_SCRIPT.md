# AgentOS LinkedIn demo script (~90–120s)

Record the **Electron window only** in OBS (Window Capture), 16:9, dark theme.

## Prep (before record)

1. Start stack: gateway healthy on `8787`
2. Start Vite + Electron
3. Sign in once so you land in the workspace
4. Have **1 bot selected**, empty-or-short chat
5. Theme: **dark**
6. Optional: one saved skill + one routine already created (so you don’t type live)
7. Optional: connectors already connected (don’t do OAuth live)

---

## Open order

| Beat | Time | Open / click | Show | Say (short) |
|------|------|--------------|------|-------------|
| 0 | 0:00 | Electron focused | Full app shell | “I’m building AgentOS — a self-hostable desktop runtime for AI agents.” |
| 1 | 0:08 | Sidebar brand + bot roster | Switch between 2 bots if you have them | “Multiple bots in one workspace, each with its own thread.” |
| 2 | 0:15 | **Chat** welcome | Hero + suggestions | “Chat is the home surface — quiet, approval-aware, on your machine.” |
| 3 | 0:22 | Send a short prompt | Streaming reply | “Agents don’t just chat — they use tools on a real VM.” |
|  |  | Example prompt: `Open example.com in the browser and tell me the page title.` | Tool call row expanding | |
| 4 | 0:40 | Header → **View agent screen** / screen control | Live VM screen | “You can watch the agent’s desktop live.” |
| 5 | 0:50 | **Take control** → move mouse → **Release** → close | Control handoff | “Or take control yourself, then hand it back.” |
| 6 | 1:00 | Sidebar → **Automations** | Skills + routines list | “Skills are reusable playbooks. Routines run them on cron, webhooks, or connector events.” |
| 7 | 1:12 | Sidebar → **Memory** | Memory entries / empty state | “Persistent memory the agent can learn and you can review.” |
| 8 | 1:20 | Sidebar → **Security** | Approval rules | “Sensitive actions wait for your approval — not silent autonomy.” |
| 9 | 1:28 | Sidebar → **Connectors** | Gmail / Calendar / etc cards | “Optional OAuth connectors and MCP servers.” |
| 10 | 1:36 | Sidebar → **Webhooks** | Subscriptions view | “Outbound webhooks for turn events.” |
| 11 | 1:42 | Sidebar → **Subagents** | Task list / empty | “Background subagents for parallel work.” |
| 12 | 1:48 | **Model** then **This computer** | Quick glance | “Model settings and local-machine permission policy.” |
| 13 | 1:55 | Theme toggle | Light ↔ dark | “First-class light and dark.” |
| 14 | 2:00 | Back to **Chat** | Composer focused | “Self-hosted. Desktop-native. Built for real work.” |

End on Chat. Freeze 1 second. Stop OBS.

---

## If you only have 60 seconds

Do beats **0 → 1 → 2 → 3 → 4 → 5 → 6 → 8 → 14**.

Skip Connectors / Webhooks / Subagents / Model / Local unless they already look populated.

---

## Do / don’t

**Do**
- Move slowly; pause 0.5s after each panel opens
- Prefer pre-created data over typing long forms
- Crop OBS to the app window (no desktop clutter)

**Don’t**
- Don’t show raw `.env`, tokens, API keys
- Don’t start a long OAuth dance live
- Don’t leave a failed red error on screen
- Don’t claim “launched / production” — say “building / preview”

---

## Caption / LinkedIn text (optional)

Building AgentOS — a self-hostable desktop agent runtime.

Multi-bot chat, live VM screen control, skills & routines, memory review, approval gates, connectors, and webhooks — running locally with Docker.

Still early. Shipping the parts that make agents feel trustworthy.
