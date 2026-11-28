use agentos_agent_core::check_permission;
use agentos_shared::{ApprovalPolicy, PermissionLevel};
use agentos_tools::{AGENT_DISPLAY_HEIGHT, AGENT_DISPLAY_WIDTH};
use serde::Serialize;

#[derive(Serialize)]
struct DesktopCapabilities {
    agent_display_width: u32,
    agent_display_height: u32,
    rust_permissions: bool,
}

#[tauri::command]
fn agentos_capabilities() -> DesktopCapabilities {
    let _ = check_permission(
        "ReadFile",
        agentos_agent_core::STATIC_CATALOG,
        &ApprovalPolicy::default(),
    );
    DesktopCapabilities {
        agent_display_width: AGENT_DISPLAY_WIDTH,
        agent_display_height: AGENT_DISPLAY_HEIGHT,
        rust_permissions: true,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![agentos_capabilities])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}