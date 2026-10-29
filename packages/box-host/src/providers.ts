/**
 * Resolve inference provider chain from env.
 * INFERENCE_MOCK=1 → mock only (BUILD_PLAN credential-check mock mode).
 * Otherwise: INFERENCE_PROVIDERS=openai,anthropic,ollama (comma-separated).
 */
import {
  type ProviderFactory,
  anthropicProvider,
  mockProvider,
  ollamaProvider,
  openaiProvider,
} from "@agentOS/inference";

const REGISTRY: Record<string, ProviderFactory> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
  mock: mockProvider,
};

export function resolveProviders(): ProviderFactory[] {
  if (process.env.INFERENCE_MOCK === "1") {
    return [mockProvider];
  }
  const names = (process.env.INFERENCE_PROVIDERS ?? "openai,anthropic,ollama")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: ProviderFactory[] = [];
  for (const name of names) {
    const p = REGISTRY[name];
    if (!p) throw new Error(`unknown inference provider "${name}" in INFERENCE_PROVIDERS`);
    out.push(p);
  }
  if (out.length === 0) throw new Error("INFERENCE_PROVIDERS must contain at least one provider");
  return out;
}
