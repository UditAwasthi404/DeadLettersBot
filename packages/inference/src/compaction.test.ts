import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  applyStepUsage,
  buildCompactionRequest,
  buildSummaryCarrier,
  compactionStyleForProvider,
} from "./compaction.ts";

const history = "user: keep the id 123";
const systemPrompt = "You are the research bot.";
const catalog = "Tools: ReadFile, SearchWeb";

describe("compaction carriers", () => {
  test("maps providers onto separate styles", () => {
    expect(compactionStyleForProvider("xai")).toBe("xai");
    expect(compactionStyleForProvider("anthropic")).toBe("anthropic");
    expect(compactionStyleForProvider("openai")).toBe("openai");
    expect(compactionStyleForProvider("ollama")).toBe("generic");
    expect(compactionStyleForProvider("mock")).toBe("generic");
  });

  test("xAI sends the original system prompt, catalog, and tools", () => {
    const request = buildCompactionRequest({
      style: "xai",
      systemPrompt,
      catalogMessage: catalog,
      history,
      tools: [{ name: "ReadFile", description: "read", parameters: z.object({}) }],
    });
    expect(request.messages[0]).toEqual({ role: "system", content: systemPrompt });
    expect(request.messages[1]?.content).toContain(catalog);
    expect(request.messages.some((message) => message.content.includes(history))).toBe(true);
    expect(request.tools?.map((tool) => tool.name)).toEqual(["ReadFile"]);
    const carrier = buildSummaryCarrier("xai", "kept 123");
    expect(carrier.role).toBe("user");
    expect(carrier.isSummary).toBe(true);
    expect(carrier.content).toContain("[xai_compaction]");
    expect(carrier.content).toContain("kept 123");
  });

  test("Anthropic omits the catalog and uses a continuation carrier", () => {
    const request = buildCompactionRequest({
      style: "anthropic",
      systemPrompt,
      catalogMessage: catalog,
      history,
      tools: [{ name: "ReadFile", description: "read", parameters: z.object({}) }],
    });
    expect(request.messages.some((message) => message.content.includes(systemPrompt))).toBe(false);
    expect(request.messages.some((message) => message.content.includes(catalog))).toBe(false);
    expect(request.tools).toBeUndefined();
    const carrier = buildSummaryCarrier("anthropic", "kept 123");
    expect(carrier.role).toBe("user");
    expect(carrier.content).toContain("<summary>");
    expect(carrier.content).toContain("ran out of context");
  });

  test("OpenAI stores a system compaction item and does not send tools", () => {
    const request = buildCompactionRequest({
      style: "openai",
      systemPrompt,
      catalogMessage: catalog,
      history,
    });
    expect(request.messages[0]?.role).toBe("system");
    expect(request.messages[0]?.content).toContain("system compaction item");
    expect(request.messages[0]?.content).not.toContain(systemPrompt);
    expect(request.tools).toBeUndefined();
    const carrier = buildSummaryCarrier("openai", "kept 123");
    expect(carrier.role).toBe("system");
    expect(carrier.isSummary).toBe(true);
    expect(carrier.content).toContain("[openai_compaction]");
  });

  test("generic compaction does not include the original system or catalog", () => {
    const request = buildCompactionRequest({
      style: "generic",
      systemPrompt,
      catalogMessage: catalog,
      history,
    });
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]?.content).not.toContain(systemPrompt);
    expect(request.messages.some((message) => message.content.includes(catalog))).toBe(false);
    const carrier = buildSummaryCarrier("generic", "kept 123");
    expect(carrier.role).toBe("user");
    expect(carrier.content.startsWith("[Conversation summary")).toBe(true);
  });
});

describe("applyStepUsage", () => {
  test("uses provider totals when the step reported them", () => {
    expect(
      applyStepUsage(
        { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        {
          promptEstimate: 10,
          completionEstimate: 4,
          provider: {
            promptTokens: 80,
            completionTokens: 20,
            totalTokens: 100,
            source: "provider",
          },
        },
      ),
    ).toEqual({ promptTokens: 80, completionTokens: 20, totalTokens: 100, source: "provider" });
  });

  test("falls back to an estimate and labels a mixed turn as an estimate", () => {
    const estimated = applyStepUsage(
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      { promptEstimate: 10, completionEstimate: 4, provider: null },
    );
    expect(estimated).toEqual({
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      source: "estimate",
    });
    expect(
      applyStepUsage(estimated, {
        promptEstimate: 1,
        completionEstimate: 1,
        provider: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      }).source,
    ).toBe("estimate");
  });
});
