//! Incremental port of `@agentos/agent-core`.

mod catalog;
mod permissions;

pub use catalog::{CatalogTool, STATIC_CATALOG};
pub use permissions::{check_permission, PermissionDeniedError};