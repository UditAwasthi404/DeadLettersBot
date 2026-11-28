use agentos_shared::PermissionLevel;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogTool {
    pub name: &'static str,
    pub permission_level: PermissionLevel,
}

/// Subset of the TypeScript `STATIC_CATALOG` used for permission tests and early Rust wiring.
/// Expand as tools migrate.
pub const STATIC_CATALOG: &[CatalogTool] = &[
    CatalogTool {
        name: "ReadFile",
        permission_level: PermissionLevel::AlwaysAllow,
    },
    CatalogTool {
        name: "WriteFile",
        permission_level: PermissionLevel::Notify,
    },
    CatalogTool {
        name: "RunShell",
        permission_level: PermissionLevel::RequireApproval,
    },
    CatalogTool {
        name: "Computer",
        permission_level: PermissionLevel::Notify,
    },
    CatalogTool {
        name: "SecureHandoff",
        permission_level: PermissionLevel::SecureHandoff,
    },
];