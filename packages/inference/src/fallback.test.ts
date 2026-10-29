import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "@agentOS/shared";
import { FallbackSession, isRetryableInferenceError } from "./fallback.ts";
import type { InferenceSession, InferenceStreamEvent } from "./session.ts";

function session(
  id: string,
  behavior: () => AsyncIterable<InferenceStreamEvent> | never,
): InferenceSession {
  return {
    providerId: id,
    purpose: "main",
    streamComplete: async function* () {
      yield* behavior();
    },
  };
}

describe("isRetryableInferenceError", () => {
  test("retries rate limits and 5xx", () => {
    expect(isRetryableInferenceError({ status: 429 })).toBe(true);
    expect(isRetryableInferenceError({ statusCode: 503 })).toBe(true);
    expect(isRetryableInferenceError({ message: "rate limit exceeded" })).toBe(true);
  });

  test("does not retry client auth errors", () => {
    expect(isRetryableInferenceError({ status: 401, message: "unauthorized" })).toBe(false);
  });
});

describe("FallbackSession", () => {
  test("falls through to secondary on rate limit before first token", async () => {
    const primary = session("a", () => {
      throw Object.assign(new Error("rate limit"), { status: 429 });
    });
    const secondary = session("b", async function* () {
      yield { type: "token", delta: "ok" };
    });
    const fb = new FallbackSession("main", [primary, secondary]);
    const msgs: ModelMessage[] = [{ role: "user", content: "hi" }];
    const out: string[] = [];
    for await (const ev of fb.streamComplete(msgs)) {
      if (ev.type === "token") out.push(ev.delta);
    }
    expect(out).toEqual(["ok"]);
  });
});
