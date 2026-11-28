import { describe, expect, it } from "vitest";
import { searchCommands } from "./command-search.ts";

describe("searchCommands", () => {
  const commands = [
    { id: "chat", label: "Chat", group: "Pages" },
    { id: "theme", label: "Toggle theme", group: "Actions" },
    { id: "bot-main", label: "Main bot", group: "Bots" },
  ];

  it("returns all commands when the query is empty", () => {
    expect(searchCommands(commands, "  ")).toEqual(commands);
  });

  it("ranks direct substring matches ahead of fuzzy matches", () => {
    const matches = searchCommands(commands, "theme");
    expect(matches[0]?.id).toBe("theme");
  });

  it("supports fuzzy character matches", () => {
    const matches = searchCommands(commands, "cht");
    expect(matches.some((command) => command.id === "chat")).toBe(true);
  });
});
