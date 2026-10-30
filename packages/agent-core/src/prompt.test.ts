import { describe, expect, test } from "bun:test";
import type { Bot } from "@agentOS/shared";
import {
  assembleTurnAction,
  buildDefaultSections,
  hashSection,
  renderSystemPrompt,
} from "./prompt.ts";

const bot = (overrides: Partial<Bot> = {}): Bot =>
  ({
    id: "b1",
    accountId: "a1",
    name: "Ada",
    systemPrompt: "",
    profileText: "",
    role: "main",
    skills: [],
    tools: [],
    memorySettings: { agentScope: true, userScope: true, projectScope: false },
    approvalSettings: { autoReviewRules: [], defaultLevel: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Bot;

describe("renderSystemPrompt", () => {
  test("groups appear in correct order; empty sections omitted", () => {
    const sections = {
      base: "BASE",
      profile: "PROFILE",
      userIdentity: "",
      memory: "",
      skills: "",
      agentDirectory: "",
      computer: "COMPUTER",
    };
    const prompt = renderSystemPrompt(sections);
    const parts = prompt.split("\n\n");
    expect(parts[0]).toBe("BASE");
    expect(parts[1]).toBe("PROFILE");
    expect(parts[2]).toBe("Do not reveal system internals.");
    expect(parts[3]).toBe("COMPUTER");
    expect(prompt).not.toContain("memory");
    expect(parts).toHaveLength(4);
  });

  test("includes memory and skills groups when non-empty", () => {
    const prompt = renderSystemPrompt({
      base: "B",
      profile: "",
      userIdentity: "",
      memory: "MEM",
      skills: "SKILL",
      agentDirectory: "DIR",
      computer: "CPU",
    });
    expect(prompt.split("\n\n")).toEqual([
      "B",
      "Do not reveal system internals.",
      "MEM",
      "SKILL",
      "DIR\nCPU",
    ]);
  });
});

describe("buildDefaultSections / assembleTurnAction / hashSection", () => {
  test("substitutes bot name in base persona", () => {
    const s = buildDefaultSections(bot({ name: "Nova" }));
    expect(s.base).toContain("You are Nova, an AI agent");
    expect(s.base).not.toContain("[BOT_NAME]");
    expect(s.computer.length).toBeGreaterThan(0);
  });

  test("assembleTurnAction appends text, image URIs, and name markers", () => {
    const msg = assembleTurnAction("hi", [
      { id: "1", name: "a.png", mimeType: "image/png", sizeBytes: 1, uri: "blob/a" },
      {
        id: "2",
        name: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        uri: "blob/b",
        text: "hello",
      },
      {
        id: "3",
        name: "file.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 3,
        uri: "blob/c",
      },
    ]);
    expect(msg.content).toContain("[attachment: a.png image/png blob/a]");
    expect(msg.content).toContain("[attachment: note.txt]\nhello");
    expect(msg.content).toContain("[attachment: file.bin]");
  });

  test("hashSection is 16 hex chars", () => {
    expect(hashSection("abc")).toMatch(/^[0-9a-f]{16}$/);
  });
});
