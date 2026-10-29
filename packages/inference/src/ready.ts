/** Inference readiness check at startup (BUILD_PLAN Track B credential check). */

import type { ProviderFactory } from "./session.ts";

export class InferenceNotReadyError extends Error {
  override readonly name = "InferenceNotReadyError";
}

/**
 * Try each provider: createSession("main"), stream empty messages with 2s timeout.
 * Resolves when any provider yields a first event; rejects if all fail.
 */
export async function inferenceReady(providers: ProviderFactory[]): Promise<void> {
  if (providers.length === 0) {
    throw new InferenceNotReadyError("no inference providers configured");
  }
  const errors: string[] = [];
  for (const factory of providers) {
    try {
      const session = factory.createSession("main");
      const iter = session.streamComplete([])[Symbol.asyncIterator]();
      const result = await Promise.race([
        iter.next(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
      ]);
      // A started response (value or clean completion) counts as ready.
      if (!result.done || result.value !== undefined) return;
      return;
    } catch (err) {
      errors.push(`${factory.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new InferenceNotReadyError(`all providers failed: ${errors.join("; ")}`);
}
