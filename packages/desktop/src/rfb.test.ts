import { describe, expect, test } from "bun:test";
import { RawVncSession } from "./rfb.ts";

function canvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
}

function handshake(name = "screen"): Uint8Array {
  const title = new TextEncoder().encode(name);
  const bytes = new Uint8Array(12 + 1 + 1 + 4 + 24 + title.length);
  bytes.set(new TextEncoder().encode("RFB 003.008\n"), 0);
  bytes[12] = 1;
  bytes[13] = 1;
  let offset = 18;
  const view = new DataView(bytes.buffer);
  view.setUint16(offset, 1280);
  view.setUint16(offset + 2, 800);
  view.setUint32(offset + 20, title.length);
  offset += 24;
  bytes.set(title, offset);
  return bytes;
}

describe("raw VNC handshake", () => {
  test("selects security type None and asks for a raw framebuffer", () => {
    const sent: Uint8Array[] = [];
    const session = new RawVncSession(canvas(), (bytes) => sent.push(bytes));
    session.push(handshake());
    expect(new TextDecoder().decode(sent[0])).toBe("RFB 003.008\n");
    expect(sent[1]).toEqual(new Uint8Array([1]));
    expect(sent[2]).toEqual(new Uint8Array([1]));
    expect(sent[3]?.[0]).toBe(0);
    expect(sent[3]?.[4]).toBe(32);
    expect(sent[4]?.[0]).toBe(2);
    expect(sent[5]?.[0]).toBe(3);
    expect(sent[5]?.[1]).toBe(0);
  });
});
