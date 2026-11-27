/**
 * Context assembly benchmark (Phase 4 Track E).
 * Target: renderSystemPrompt() P99 < 200ms under 100 concurrent bots.
 * Run: bun test src/prompt.bench.ts
 */
import { describe, expect, test } from "bun:test";
import type { Bot } from "@agentos/shared";
import { buildDefaultSections, hashSection, renderSystemPrompt } from "./prompt.ts";

const bot = (index: number): Bot =>
  ({
    id: `b${index}`,
    accountId: "a1",
    name: `Bot${index}`,
    systemPrompt: "",
    profileText: `Profile for bot ${index}`.repeat(20),
    role: "main",
    skills: [`skill-${index}`],
    tools: [],
    memorySettings: { agentScope: true, userScope: true, projectScope: false },
    approvalSettings: { autoReviewRules: [], defaultLevel: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Bot;

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

describe("context assembly benchmarks", () => {
  test("renderSystemPrompt P99 stays under 200ms for 100 concurrent bots", async () => {
    const warm = buildDefaultSections(bot(0));
    warm.memory = "user: prefers concise replies\nproject: AgentOS\nagent: uses tools";
    warm.skills = "1. Draft notes\n2. Summarize email";
    warm.agentDirectory = Array.from({ length: 20 }, (_, i) => `Bot${i}`).join(", ");
    renderSystemPrompt(warm);
    hashSection(warm.base);

    const durations: number[] = [];
    await Promise.all(
      Array.from({ length: 100 }, async (_, index) => {
        const started = performance.now();
        const sections = buildDefaultSections(bot(index));
        sections.memory = `user: marker-${index}\nproject: AgentOS\nagent: task-${index}`;
        sections.skills = `Skill ${index}: do useful work with tools`;
        sections.agentDirectory = Array.from({ length: 20 }, (_, i) => `Peer${i}`).join(", ");
        const prompt = renderSystemPrompt(sections);
        hashSection(sections.base);
        hashSection(prompt);
        durations.push(performance.now() - started);
      }),
    );

    const p99 = percentile(durations, 99);
    expect(p99).toBeLessThan(200);
  });
});
