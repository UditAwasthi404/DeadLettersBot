/**
 * Provider fallback: primary → secondary → tertiary on rate limit / error
 * (ARCHITECTURE.md §6).
 */
import type { ModelMessage } from "@agentOS/shared";
import type {
  InferencePurpose,
  InferenceSession,
  InferenceStreamEvent,
  InferenceTool,
  ProviderFactory,
} from "./session.ts";

export function isRetryableInferenceError(err: unknown): boolean {
  if (!err || typeof err !== "object") return true;
  const e = err as { statusCode?: number; status?: number; message?: string };
  const status = e.statusCode ?? e.status;
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("overloaded") ||
    msg.includes("econnreset")
  );
}

export class FallbackSession implements InferenceSession {
  readonly purpose: InferencePurpose;
  readonly providerId: string;
  private readonly chain: InferenceSession[];

  constructor(purpose: InferencePurpose, sessions: InferenceSession[]) {
    if (sessions.length === 0) throw new Error("FallbackSession requires at least one provider");
    this.purpose = purpose;
    this.chain = sessions;
    this.providerId = sessions.map((s) => s.providerId).join(">");
  }

  async *streamComplete(
    messages: ModelMessage[],
    tools?: InferenceTool[],
  ): AsyncIterable<InferenceStreamEvent> {
    let lastError: unknown;
    for (let i = 0; i < this.chain.length; i++) {
      const session = this.chain[i];
      if (!session) continue;
      try {
        // Buffer first event so a cold failure before any yield can fall through.
        const iter = session.streamComplete(messages, tools)[Symbol.asyncIterator]();
        const first = await iter.next();
        if (first.done) return;
        yield first.value;
        while (true) {
          const next = await iter.next();
          if (next.done) return;
          yield next.value;
        }
      } catch (err) {
        lastError = err;
        const hasNext = i < this.chain.length - 1;
        if (!hasNext || !isRetryableInferenceError(err)) throw err;
      }
    }
    throw lastError;
  }
}

export function createFallbackSession(
  purpose: InferencePurpose,
  providers: ProviderFactory[],
  models?: Partial<Record<string, string>>,
): InferenceSession {
  const sessions = providers.map((p) => p.createSession(purpose, models?.[p.id]));
  return new FallbackSession(purpose, sessions);
}
