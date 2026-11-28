use agentos_shared::{ApprovalPolicy, AutoReviewMode, PermissionLevel};
use regex::Regex;
use thiserror::Error;

use crate::catalog::CatalogTool;

#[derive(Debug, Error, PartialEq, Eq)]
#[error("unadvertised tool")]
pub struct PermissionDeniedError;

pub fn check_permission(
    tool_name: &str,
    catalog: &[CatalogTool],
    policy: &ApprovalPolicy,
) -> Result<PermissionLevel, PermissionDeniedError> {
    let tool = catalog
        .iter()
        .find(|t| t.name == tool_name)
        .ok_or(PermissionDeniedError)?;

    let mut matching_requires = false;
    let mut matching_always_allow = false;

    for rule in &policy.auto_review_rules {
        let Ok(re) = Regex::new(&rule.action_pattern) else {
            continue;
        };
        if !re.is_match(tool_name) {
            continue;
        }
        match rule.mode {
            AutoReviewMode::Require => matching_requires = true,
            AutoReviewMode::AlwaysAllow => matching_always_allow = true,
        }
    }

    if matching_requires {
        return Ok(PermissionLevel::RequireApproval);
    }
    if matching_always_allow {
        return Ok(PermissionLevel::AlwaysAllow);
    }

    Ok(std::cmp::max(tool.permission_level, policy.default_level))
}

#[cfg(test)]
mod tests {
    use agentos_shared::{ApprovalPolicy, AutoReviewMode, AutoReviewRule, PermissionLevel};

    use crate::catalog::STATIC_CATALOG;

    use super::{check_permission, PermissionDeniedError};

    fn base_policy(
        auto_review_rules: Vec<AutoReviewRule>,
        default_level: PermissionLevel,
    ) -> ApprovalPolicy {
        ApprovalPolicy {
            auto_review_rules,
            default_level,
        }
    }

    #[test]
    fn unadvertised_tool_errors() {
        let err =
            check_permission("NotATool", STATIC_CATALOG, &ApprovalPolicy::default()).unwrap_err();
        assert_eq!(err, PermissionDeniedError);
    }

    #[test]
    fn auto_review_require_overrides_catalog() {
        let policy = base_policy(
            vec![AutoReviewRule {
                action_pattern: "^ReadFile$".into(),
                mode: AutoReviewMode::Require,
            }],
            PermissionLevel::AlwaysAllow,
        );
        let level = check_permission("ReadFile", STATIC_CATALOG, &policy).unwrap();
        assert_eq!(level, PermissionLevel::RequireApproval);
    }

    #[test]
    fn auto_review_always_allow() {
        let policy = base_policy(
            vec![AutoReviewRule {
                action_pattern: "^RunShell$".into(),
                mode: AutoReviewMode::AlwaysAllow,
            }],
            PermissionLevel::RequireApproval,
        );
        let level = check_permission("RunShell", STATIC_CATALOG, &policy).unwrap();
        assert_eq!(level, PermissionLevel::AlwaysAllow);
    }

    #[test]
    fn max_of_catalog_and_default() {
        let policy = base_policy(vec![], PermissionLevel::RequireApproval);
        let level = check_permission("ReadFile", STATIC_CATALOG, &policy).unwrap();
        assert_eq!(level, PermissionLevel::RequireApproval);
    }
}