//! Scaffold for `@agentos/tools` — computer-use, browser CDP, file and shell tools.

/// Canonical agent VM display size (matches Xvfb in `ensure-bot-browser.sh`).
pub const AGENT_DISPLAY_WIDTH: u32 = 1280;
pub const AGENT_DISPLAY_HEIGHT: u32 = 800;

/// Terminal focus geometry when raised alongside the 1280×800 canvas.
pub const TERMINAL_FOCUS_WIDTH: u32 = 1120;
pub const TERMINAL_FOCUS_HEIGHT: u32 = 640;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_resolution_matches_vm() {
        assert_eq!(AGENT_DISPLAY_WIDTH, 1280);
        assert_eq!(AGENT_DISPLAY_HEIGHT, 800);
    }
}