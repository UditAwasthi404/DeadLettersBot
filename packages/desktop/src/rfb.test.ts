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
    expect(sent[4]?.[3]).toBe(2);
    expect(sent[4]?.[7]).toBe(1);
    expect(sent[5]?.[0]).toBe(3);
    expect(sent[5]?.[1]).toBe(0);
    session.dispose();
  });

  test("reassembles a handshake that arrives in tiny chunks", () => {
    const sent: Uint8Array[] = [];
    const session = new RawVncSession(canvas(), (bytes) => sent.push(bytes));
    const bytes = handshake();
    for (const byte of bytes) session.push(new Uint8Array([byte]));
    expect(sent[5]?.[0]).toBe(3);
    session.dispose();
  });

  test("copies a rectangle and paints raw pixels with opaque alpha", () => {
    const paints: Array<{ kind: string; x: number; y: number; data?: Uint8ClampedArray }> = [];
    const ctx = {
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      getImageData: (x: number, y: number, width: number, height: number) => {
        paints.push({ kind: "get", x, y });
        return { data: new Uint8ClampedArray(width * height * 4) };
      },
      putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number) => {
        paints.push({ kind: "put", x, y, data: image.data });
      },
    };
    const surface = {
      width: 0,
      height: 0,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const sent: Uint8Array[] = [];
    const session = new RawVncSession(surface, (bytes) => sent.push(bytes));
    session.push(handshake());
    session.push(rawPixel(4, 6, 9, 10, 20, 30));
    const painted = paints.find((paint) => paint.kind === "put");
    expect(painted?.x).toBe(4);
    expect(painted?.y).toBe(6);
    expect(Array.from(painted?.data ?? []).slice(0, 4)).toEqual([9, 10, 20, 255]);
    paints.length = 0;
    session.push(copyRect(8, 9, 2, 3));
    expect(paints.map((paint) => `${paint.kind}:${paint.x},${paint.y}`)).toEqual([
      "get:2,3",
      "put:8,9",
    ]);
    session.dispose();
  });

  test("waits before asking for the next incremental frame", async () => {
    const sent: Uint8Array[] = [];
    const session = new RawVncSession(canvas(), (bytes) => sent.push(bytes));
    session.push(handshake());
    const mark = sent.length;
    session.push(rawPixel(0, 0, 1, 2, 3, 4));
    expect(sent.slice(mark).some((message) => message[0] === 3 && message[1] === 1)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(sent.slice(mark).some((message) => message[0] === 3 && message[1] === 1)).toBe(true);
    session.dispose();
  });

  test("fast framebuffer blit beats a per-pixel copy", () => {
    const raw = new Uint8Array(1280 * 800 * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = i & 255;
      raw[i + 1] = (i >> 8) & 255;
      raw[i + 2] = 40;
    }
    const once = (fn: (pixels: Uint8Array) => Uint8ClampedArray) => {
      const started = performance.now();
      let last = new Uint8ClampedArray(0);
      for (let i = 0; i < 4; i += 1) last = fn(raw);
      return { ms: performance.now() - started, alpha: last[3] };
    };
    const slow = once(blitSlow);
    const fast = once(blitFast);
    expect(slow.alpha).toBe(255);
    expect(fast.alpha).toBe(255);
    expect(fast.ms).toBeLessThan(slow.ms);
  });
});

function blitSlow(raw: Uint8Array): Uint8ClampedArray {
  const image = new Uint8ClampedArray(raw.length);
  for (let i = 0; i < raw.length; i += 4) {
    image[i] = raw[i] ?? 0;
    image[i + 1] = raw[i + 1] ?? 0;
    image[i + 2] = raw[i + 2] ?? 0;
    image[i + 3] = 255;
  }
  return image;
}

function blitFast(raw: Uint8Array): Uint8ClampedArray {
  const image = new Uint8ClampedArray(raw.length);
  image.set(raw);
  for (let i = 3; i < image.length; i += 4) image[i] = 255;
  return image;
}

function rawPixel(
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  pad: number,
): Uint8Array {
  const bytes = new Uint8Array(4 + 12 + 4);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1);
  view.setUint16(4, x);
  view.setUint16(6, y);
  view.setUint16(8, 1);
  view.setUint16(10, 1);
  bytes[16] = red;
  bytes[17] = green;
  bytes[18] = blue;
  bytes[19] = pad;
  return bytes;
}

function copyRect(x: number, y: number, srcX: number, srcY: number): Uint8Array {
  const bytes = new Uint8Array(4 + 12 + 4);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1);
  view.setUint16(4, x);
  view.setUint16(6, y);
  view.setUint16(8, 2);
  view.setUint16(10, 2);
  view.setInt32(12, 1);
  view.setUint16(16, srcX);
  view.setUint16(18, srcY);
  return bytes;
}
