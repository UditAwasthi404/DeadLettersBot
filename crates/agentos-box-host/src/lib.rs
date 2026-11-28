//! Scaffold for `@agentos/box-host`. The production gateway still runs on Bun/TypeScript.
//! HTTP/WebSocket serving will migrate here behind `run_host_main`.

/// Returns whether the Rust gateway binary is wired (not yet — use `packages/box-host`).
pub fn rust_gateway_available() -> bool {
    false
}