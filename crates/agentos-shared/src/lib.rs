//! Core protocol and config types — incremental port of `@agentos/shared`.

mod policy;

pub use policy::{ApprovalPolicy, AutoReviewMode, AutoReviewRule, PermissionLevel};