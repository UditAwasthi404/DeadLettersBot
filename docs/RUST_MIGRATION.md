# Rust migration (Tauri v2)

AgentOS is moving backend and core logic from TypeScript to a Rust workspace while keeping the React UI as the Tauri webview frontend. **Electron + pnpm remain the supported desktop path** until the Rust gateway and Tauri shell reach parity.

## Workspace layout

| Crate | TypeScript source | Status |
|-------|-------------------|--------|
| `crates/agentos-shared` | `packages/shared` (types) | **Started** — `PermissionLevel`, `ApprovalPolicy` |
| `crates/agentos-agent-core` | `packages/agent-core` | **Started** — `check_permission`, catalog subset, tests |
| `crates/agentos-tools` | `packages/tools` | **Scaffold** — VM geometry constants |
| `crates/agentos-rfb` | `packages/desktop/src/rfb.ts` | **Started** — Raw + CopyRect decode helpers + tests |
| `crates/agentos-inference` | `packages/inference` | **Scaffold** |
| `crates/agentos-box-host` | `packages/box-host` | **Scaffold** |
| `apps/agentos-tauri` | `packages/desktop` (shell only) | **Scaffold** — loads Vite dev URL / `desktop/dist` |

Spec layout aliases (`shared/`, `rfb/`, …) map 1:1 to the `agentos-*` crate names above.

TypeScript packages are **not removed** until each area has passing Rust tests and a wired integration.

## Build and test

```sh
rustc --version  # 1.85+ recommended; see rust-toolchain.toml
cargo build --workspace
cargo test --workspace
cargo clippy --workspace -- -D warnings
```

Tauri shell (GTK/WebKit dev libs required on Linux):

```sh
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
cargo install tauri-cli --version "^2.0" --locked
cd apps/agentos-tauri/src-tauri
cargo build
cargo tauri dev
```

## Remaining work (by crate)

1. **shared** — Protocol frames, Drizzle schema → `sqlx` migrations, Redis/blob clients.
2. **tools** — Computer-use X11/CDP, Playwright sidecar or chrommiumoxide, file/shell tools.
3. **inference** — OpenAI/Anthropic/xAI/Ollama HTTP streaming (replace Vercel AI SDK).
4. **agent-core** — Prompt assembly, full `STATIC_CATALOG`, dispatcher.
5. **box-host** — Hono-equivalent axum/hyper gateway, WebSocket turns, workers.
6. **Tauri** — Parity with Electron preload (`window.agentOS`), auto-update, Clerk bridge.

## FFI / process boundaries

Until browser automation ports:

- VM CDP proxy and VNC stay in the Linux VM image (`infra/docker`).
- Playwright may remain a short-lived Node sidecar invoked from Rust, then retire.

Document behavioral parity in this file as each subsystem lands.