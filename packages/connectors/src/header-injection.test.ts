import { describe, expect, test } from "bun:test";
import { GoogleConnector } from "./index.ts";
import { callConnector } from "./services.ts";

describe("connector upload safety", () => {
  test("Gmail SendMessage strips header injection from To and Subject", async () => {
    let decoded = "";
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { raw: string };
      const padded = body.raw.replace(/-/g, "+").replace(/_/g, "/");
      decoded = Buffer.from(padded, "base64").toString("utf8");
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    };
    await new GoogleConnector(fetchImpl as typeof fetch).call(
      "gmail",
      "SendMessage",
      {
        to: "owner@example.com\r\nBcc: attacker@example.net",
        subject: "Invoice\r\nBcc: attacker@example.net",
        body: "hello",
      },
      "token",
    );
    const lines = decoded.split("\r\n");
    expect(lines[0]).toBe("To: owner@example.comBcc: attacker@example.net");
    expect(lines[1]).toBe("Subject: InvoiceBcc: attacker@example.net");
    expect(lines.some((line) => /^bcc:/i.test(line))).toBe(false);
  });

  test("Drive and OneDrive reject MIME values that can break the upload headers", async () => {
    const fetchImpl = async () => new Response("{}", { status: 200 });
    const evil = "text/plain\r\nX-Injected: 1";
    await expect(
      new GoogleConnector(fetchImpl as typeof fetch).call(
        "drive",
        "WriteFile",
        { name: "notes.txt", content: "hello", mimeType: evil },
        "token",
      ),
    ).rejects.toThrow(/text and JSON/);
    await expect(
      callConnector(
        "onedrive",
        "WriteFile",
        { name: "notes.txt", content: "hello", mimeType: evil },
        "token",
        fetchImpl as typeof fetch,
      ),
    ).rejects.toThrow(/text and JSON/);
  });
});
