/**
 * Resolve inference provider chain from env.
 * INFERENCE_MOCK=1 → mock only (BUILD_PLAN credential-check mock mode).
 * Otherwise: INFERENCE_PROVIDERS=xai (comma-separated). Grok is the default answer provider.
 */
import {
  type ProviderFactory,
  anthropicProvider,
  mockProvider,
  ollamaProvider,
  openaiProvider,
  xaiProvider,
} from "@agentOS/inference";

const REGISTRY: Record<string, ProviderFactory> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  xai: xaiProvider,
  ollama: ollamaProvider,
  mock: mockProvider,
};

export function resolveProviders(): ProviderFactory[] {
  if (process.env.INFERENCE_MOCK === "1") {
    return [mockProvider];
  }
  const names = (process.env.INFERENCE_PROVIDERS ?? "xai")
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
