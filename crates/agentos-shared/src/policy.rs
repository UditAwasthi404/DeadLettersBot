use serde::{Deserialize, Serialize};

/// Tool permission level (matches TypeScript `PermissionLevel`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum PermissionLevel {
    AlwaysAllow = 0,
    Notify = 1,
    RequireApproval = 2,
    SecureHandoff = 3,
}

impl PermissionLevel {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

impl From<PermissionLevel> for u8 {
    fn from(value: PermissionLevel) -> Self {
        value.as_u8()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoReviewMode {
    Require,
    AlwaysAllow,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutoReviewRule {
    pub action_pattern: String,
    pub mode: AutoReviewMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalPolicy {
    #[serde(default)]
    pub auto_review_rules: Vec<AutoReviewRule>,
    pub default_level: PermissionLevel,
}

impl Default for ApprovalPolicy {
    fn default() -> Self {
        Self {
            auto_review_rules: Vec::new(),
            default_level: PermissionLevel::AlwaysAllow,
        }
    }
}