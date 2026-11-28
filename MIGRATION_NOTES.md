# AgentOS 2.0 — Migration Notes

Working branch: `qoder/agentos-2`  
Base: `main` @ `37b0c13` (includes computer-use / PR #6)  
Optional reference: `cursor/agentos-polish-rust-tauri-1c84` (PR #7) — cherry-pick useful pieces; do not depend on it.

## Feature inventory (§2) — must survive

| Area | Item | Status |
| --- | --- | --- |
| Workspace nav | Chat, Memory, Security, Automations, Subagents, Connectors, Webhooks, Model, This computer | ✓ present |
| Bots | list, search, create (+), select, Main label, per-bot VM | ✓ present |
| Chat | send, stream, stop, retry, attachments, markdown, code blocks | ✓ present |
| Agent screen | live VNC, takeover/release, refresh, close, Chrome/Terminal, clock | ✓ present |
| Computer-use tools | screenshot…stuck detection, planner, handoff | ✓ present |
| Send-button finding | accessible name → icon → Enter | ✓ present |
| Browser | CDP loopback, Playwright lazy-load | ✓ present |
| Pointer | xdotool / Node fallback | ✓ present |
| Theme | Light / System / Dark + connection status | ✓ present |
| Providers / Memory / Automations / Webhooks / Connectors | ✓ present |
| Env flags | `AGENTOS_DISABLE_GPU` (+ others as found) | ✓ present |

Re-verify this table at the end of each milestone. Mark ✕ only when intentionally deferred below.

## Deferred

- Full product UI swap from Radix/`AppButton` to every new design-system component (gallery proves the system; chat gradually adopts).
- Toast swipe-to-dismiss.
- Pop-out always-on-top agent screen (stretch goal §4.3).
- Removing Electron / TS backend (M5–M6 only).
- Full Rust/Tauri parity (M4+).

## Known issues (pre-existing on main)

- None newly introduced for M1. If something on main looks wrong, leave it and note it here.

## Milestones

### M1 — Design system & shell (in progress → complete when pushed)

**Delivered**

- Design tokens: `packages/desktop/src/design/tokens.css` + `tokens.ts` (+ legacy bridge).
- §3.6 components under `packages/desktop/src/components/` + `components.css`.
- Gallery route: `/__gallery` or `#/__gallery`.
- Shell: custom titlebar (Win/Linux controls), sidebar collapse, ⌘/Ctrl+K command palette, shell CSS restyle.
- i18n scaffold: `packages/desktop/src/i18n/en.json`.
- Bench script: `bench/desktop-launch.mjs`.
- Stylelint hex guard outside tokens; Vitest UI test for command search.

**Manual QA (M1)**

1. `pnpm --filter @agentos/desktop typecheck`
2. `pnpm --filter @agentos/desktop test`
3. `pnpm --filter @agentos/desktop lint`
4. Launch Electron; confirm titlebar + drag region; Win/Linux min/max/close work.
5. Toggle sidebar via titlebar button; confirm icons-only collapsed mode.
6. ⌘/Ctrl+K opens palette; navigate with arrows; Enter runs an action.
7. Open `#/__gallery` (or `/__gallery` via Vite); flip Light/Dark; Tab through focus rings.

**Benchmarks** — run after Electron + Vite are up: `node bench/desktop-launch.mjs m1-baseline` (results under `.tmp/agentos-bench/`).

### M2 — My computer dock

Not started.

### M3 — VM image

Cherry-pick candidates from PR #7: tint2, Chromium initial prefs, `docs/VM_DESKTOP.md`, 1280×800.

### M4–M6 — Rust / Tauri / cleanup

Scaffold on PR #7 is reference only until M4.

## Benchmarks

| Metric | Before | After | Script |
| --- | --- | --- | --- |
| Cold start → interactive (dev, Playwright overhead) | _pending_ | _pending_ | `bench/desktop-launch.mjs` |

## Manual QA script (§10)

Full 15-step Linux/Windows script lands at M6. M1 steps listed above.
