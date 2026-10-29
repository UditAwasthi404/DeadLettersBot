import { describe, expect, test } from "bun:test";
import { mockProvider } from "./providers/mock.ts";
import { InferenceNotReadyError, inferenceReady } from "./ready.ts";
import type { ProviderFactory } from "./session.ts";

describe("inferenceReady", () => {
  test("resolves when a provider streams", async () => {
    await inferenceReady([mockProvider]);
  });

  test("rejects when all providers fail", async () => {
    const bad: ProviderFactory = {
      id: "bad",
      createSession() {
        return {
          providerId: "bad",
          purpose: "main",
          streamComplete() {
            return {
              [Symbol.asyncIterator]() {
                return {
                  next() {
                    return Promise.reject(new Error("down"));
                  },
                };
              },
            };
          },
        };
      },
    };
    await expect(inferenceReady([bad])).rejects.toBeInstanceOf(InferenceNotReadyError);
  });
});
