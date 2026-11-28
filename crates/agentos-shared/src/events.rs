//! Agent event frames — mirrored from the Electron `onFrame` payload shapes.
//!
//! # Public surface checklist
//! - [x] `AgentEvent` tagged enum (token / activity / tool / handoff / settled / error)
//! - [x] JSON round-trip via serde
//! - [ ] Full parity with every Electron frame field
//! - [ ] Binary VNC frame transport (Tauri protocol / WS)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentEvent {
    #[serde(rename = "token")]
    Token {
        #[serde(default)]
        run_id: Option<String>,
        #[serde(default)]
        agent_id: Option<String>,
        #[serde(default)]
        text: Option<String>,
    },
    #[serde(rename = "activity")]
    Activity {
        #[serde(default)]
        label: Option<String>,
        #[serde(default)]
        step: Option<u32>,
        #[serde(rename = "stepBudget", default)]
        step_budget: Option<u32>,
        #[serde(default)]
        plan: Option<String>,
    },
    #[serde(rename = "toolStart")]
    ToolStart {
        #[serde(rename = "toolName", default)]
        tool_name: Option<String>,
        #[serde(default)]
        params: Option<serde_json::Value>,
        #[serde(default)]
        run_id: Option<String>,
        #[serde(default)]
        agent_id: Option<String>,
    },
    #[serde(rename = "secureHandoff")]
    SecureHandoff {
        #[serde(default)]
        agent_id: Option<String>,
        #[serde(default)]
        run_id: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    #[serde(rename = "settled")]
    Settled {
        #[serde(default)]
        run_id: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(default)]
        code: Option<String>,
        #[serde(default)]
        message: Option<String>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_round_trip_matches_ts_fixture() {
        let raw = r#"{"type":"activity","label":"Clicked Send","step":4,"stepBudget":12,"plan":"1. Open site\n2. Click Send"}"#;
        let event: AgentEvent = serde_json::from_str(raw).unwrap();
        let again: AgentEvent = serde_json::from_str(&serde_json::to_string(&event).unwrap()).unwrap();
        assert_eq!(event, again);
        match event {
            AgentEvent::Activity {
                label,
                step,
                step_budget,
                ..
            } => {
                assert_eq!(label.as_deref(), Some("Clicked Send"));
                assert_eq!(step, Some(4));
                assert_eq!(step_budget, Some(12));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn handoff_round_trip() {
        let raw = r#"{"type":"secureHandoff","agentId":"bot-1","runId":"run-9","reason":"Sign in"}"#;
        let event: AgentEvent = serde_json::from_str(raw).unwrap();
        assert!(matches!(
            event,
            AgentEvent::SecureHandoff {
                reason: Some(ref r),
                ..
            } if r == "Sign in"
        ));
    }
}
