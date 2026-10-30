import { describe, expect, test } from "bun:test";
import { callConnector } from "@agentOS/connectors";
import { recordingAccepts } from "@agentOS/tools";
import { createDebouncer } from "./debounce.ts";
import { parseSkillDraft } from "./skill-draft.ts";
import { botWorkspacePath } from "./workspace-path.ts";

describe("phase 3 close-out", () => {
  test("file watch paths stay inside the bot workspace", () => {
    expect(botWorkspacePath("/home/agent/notes.txt")).toBe("/home/agent/notes.txt");
    expect(botWorkspacePath("/home/agent/../etc/passwd")).toBeNull();
    expect(botWorkspacePath("/tmp/notes.txt")).toBeNull();
    expect(botWorkspacePath("home/agent")).toBeNull();
  });

  test("skill draft parser accepts fenced JSON", () => {
    const draft = parseSkillDraft(
      '```json\n{"name":"Save a note","description":"Write it","steps":[{"instruction":"Open the editor"}]}\n```',
    );
    expect(draft.steps).toEqual([{ instruction: "Open the editor" }]);
  });

  test("debounced file events fire once", () => {
    const pending = new Map<string, () => void>();
    const debouncer = createDebouncer(1000, (fn) => {
      pending.set("timer", fn);
      return () => pending.delete("timer");
    });
    let fires = 0;
    debouncer.trigger("routine", () => {
      fires += 1;
    });
    debouncer.trigger("routine", () => {
      fires += 1;
    });
    expect(fires).toBe(0);
    pending.get("timer")?.();
    expect(fires).toBe(1);
  });

  test("recording stops accepting events after 10 minutes", () => {
    const started = 0;
    expect(recordingAccepts(started, 60_000, 1)).toBe(true);
    expect(recordingAccepts(started, 10 * 60 * 1000 + 1, 1)).toBe(false);
  });

  test("connector calls reject unknown actions and use the Salesforce instance", async () => {
    await expect(callConnector("onedrive", "SendMessage", {}, "token", fetch)).rejects.toThrow(
      "unsupported onedrive action",
    );
    let requested = "";
    const fetchImpl: typeof fetch = async (input) => {
      requested = String(input);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    await callConnector(
      "salesforce",
      "QueryRecords",
      { query: "SELECT Id FROM Account" },
      "token",
      fetchImpl,
      "https://example.my.salesforce.com",
    );
    expect(
      requested.startsWith("https://example.my.salesforce.com/services/data/v59.0/query"),
    ).toBe(true);
    await expect(
      callConnector(
        "salesforce",
        "QueryRecords",
        { query: "SELECT Id FROM Account" },
        "token",
        fetchImpl,
        "https://evil.example",
      ),
    ).rejects.toThrow("Salesforce instance URL");
  });
});
