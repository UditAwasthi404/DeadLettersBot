import { describe, expect, test } from "bun:test";
import { rootWindowFromSetup, warpPointerPacket } from "./x11-pointer.ts";

describe("X11 pointer packets", () => {
  test("builds a WarpPointer request for the root window", () => {
    const packet = warpPointerPacket(0x2a, 640, 400);
    expect(packet[0]).toBe(41);
    expect(packet.readUInt16LE(2)).toBe(6);
    expect(packet.readUInt32LE(8)).toBe(0x2a);
    expect(packet.readInt16LE(20)).toBe(640);
    expect(packet.readInt16LE(22)).toBe(400);
    expect(packet.length).toBe(24);
  });

  test("reads the root window from a minimal setup reply", () => {
    const setup = Buffer.alloc(8 + 32 + 4);
    setup[0] = 1;
    setup.writeUInt16LE(0, 8 + 16);
    setup[8 + 21] = 0;
    setup.writeUInt32LE(77, 8 + 32);
    expect(rootWindowFromSetup(setup)).toBe(77);
    expect(rootWindowFromSetup(Buffer.from([0]))).toBeNull();
  });
});
