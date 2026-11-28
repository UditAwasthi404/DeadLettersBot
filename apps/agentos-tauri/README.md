# AgentOS Tauri shell (preview)

Tauri v2 desktop host that will replace Electron. The UI still builds from `packages/desktop` (Vite + React).

## Commands

From the repository root:

```sh
# Build Rust workspace (all crates + Tauri lib)
cargo build --workspace

cargo test --workspace
cargo clippy --workspace -- -D warnings

# Dev: Vite on 5173 + Tauri window (requires a display or nested X)
cargo tauri dev --manifest-path apps/agentos-tauri/src-tauri/Cargo.toml
```

Production Electron flow is unchanged: `pnpm --filter @agentos/desktop electron`.

See [Rust migration](../../docs/RUST_MIGRATION.md) for port status.