//! Core protocol and config types — incremental port of `@agentos/shared`.
//!
//! # Public surface checklist
//! - [x] `PermissionLevel`, `ApprovalPolicy`, auto-review rules
//! - [x] `AgentEvent` JSON frames (subset)
//! - [ ] Full shared config / ids / figment loading
//! - [ ] Error enum covering all crates

mod events;
mod policy;

pub use events::AgentEvent;
pub use policy::{ApprovalPolicy, AutoReviewMode, AutoReviewRule, PermissionLevel};