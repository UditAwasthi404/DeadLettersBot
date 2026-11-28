import { describe, expect, test } from "bun:test";
import { decodeTextAttachment, sanitizeForJsonb, stripNullBytes } from "./jsonb-safe.ts";

describe("jsonb-safe", () => {
  test("strips null bytes from nested payloads", () => {
    const dirty = {
      content: "hello\u0000world",
      nested: [{ text: "a\u0000b" }],
    };
    expect(sanitizeForJsonb(dirty)).toEqual({
      content: "helloworld",
      nested: [{ text: "ab" }],
    });
    expect(stripNullBytes("x\u0000y")).toBe("xy");
  });

  test("decodes UTF-16LE attachments with BOM", () => {
    const text = "Learn";
    const bom = new Uint8Array([0xff, 0xfe, ...Buffer.from(text, "utf16le")]);
    expect(decodeTextAttachment(bom)).toBe(text);
  });

  test("decodes UTF-16LE without BOM when null density is high", () => {
    const encoded = Buffer.from("Learn", "utf16le");
    expect(decodeTextAttachment(new Uint8Array(encoded))).toBe("Learn");
  });
});
