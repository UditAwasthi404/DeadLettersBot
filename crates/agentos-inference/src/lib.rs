//! Scaffold for `@agentos/inference` — provider sessions and streaming land here incrementally.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InferenceProviderKind {
    OpenAi,
    Anthropic,
    Ollama,
    Xai,
    Mock,
}

/// Placeholder until HTTP provider adapters migrate from TypeScript.
pub fn inference_ready() -> bool {
    false
}