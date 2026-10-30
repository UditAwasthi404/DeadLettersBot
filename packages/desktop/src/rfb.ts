/** Raw-encoding RFB 3.8 client. The pixels come from the app's gateway socket, not a remote page. */

const CLIENT_VERSION = new TextEncoder().encode("RFB 003.008\n");

export class RawVncSession {
  private buf = new Uint8Array(0);
  private stage:
    | "version"
    | "secCount"
    | "secTypes"
    | "secResult"
    | "init"
    | "name"
    | "server"
    | "rect"
    | "raw"
    | "failed" = "version";
  private secCount = 0;
  private nameLength = 0;
  private width = 0;
  private height = 0;
  private rectsLeft = 0;
  private rectX = 0;
  private rectY = 0;
  private rectW = 0;
  private rectH = 0;
  private raw = new Uint8Array(0);
  private rawFilled = 0;
  private rawLeft = 0;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sendBytes: (bytes: Uint8Array) => void,
    private readonly onError: (message: string) => void = () => {},
  ) {
    this.ctx = canvas.getContext("2d");
  }

  push(chunk: Uint8Array): void {
    if (this.stage === "failed" || chunk.byteLength === 0) return;
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    try {
      this.pump();
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  pointer(x: number, y: number, buttons: number): void {
    if (this.width < 1 || this.height < 1 || this.stage === "failed") return;
    const msg = new Uint8Array(6);
    msg[0] = 5;
    msg[1] = buttons & 7;
    writeU16(msg, 2, clamp(x, 0, this.width - 1));
    writeU16(msg, 4, clamp(y, 0, this.height - 1));
    this.sendBytes(msg);
  }

  key(keysym: number, down: boolean): void {
    if (this.stage === "failed") return;
    const msg = new Uint8Array(8);
    msg[0] = 4;
    msg[1] = down ? 1 : 0;
    writeU32(msg, 4, keysym);
    this.sendBytes(msg);
  }

  private pump(): void {
    while (this.stage !== "failed") {
      if (this.stage === "version") {
        const banner = this.take(12);
        if (!banner) return;
        if (new TextDecoder().decode(banner) !== "RFB 003.008\n")
          throw new Error("unsupported VNC version");
        this.sendBytes(CLIENT_VERSION);
        this.stage = "secCount";
        continue;
      }
      if (this.stage === "secCount") {
        const count = this.take(1);
        if (!count) return;
        this.secCount = count[0] ?? 0;
        if (this.secCount < 1) throw new Error("VNC server offered no security types");
        this.stage = "secTypes";
        continue;
      }
      if (this.stage === "secTypes") {
        const types = this.take(this.secCount);
        if (!types) return;
        if (!types.includes(1)) throw new Error("VNC server requires a password");
        this.sendBytes(new Uint8Array([1]));
        this.stage = "secResult";
        continue;
      }
      if (this.stage === "secResult") {
        const result = this.take(4);
        if (!result) return;
        if (readU32(result, 0) !== 0) throw new Error("VNC security failed");
        this.sendBytes(new Uint8Array([1]));
        this.stage = "init";
        continue;
      }
      if (this.stage === "init") {
        const header = this.take(24);
        if (!header) return;
        this.width = readU16(header, 0);
        this.height = readU16(header, 2);
        this.nameLength = readU32(header, 20);
        if (this.width < 1 || this.height < 1 || this.width > 4096 || this.height > 4096)
          throw new Error("VNC screen size is invalid");
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.stage = "name";
        continue;
      }
      if (this.stage === "name") {
        if (!this.take(this.nameLength)) return;
        this.sendBytes(pixelFormatMessage());
        this.sendBytes(rawEncodingMessage());
        this.requestUpdate(false);
        this.stage = "server";
        continue;
      }
      if (this.stage === "server") {
        if (this.buf.length < 1) return;
        const type = this.buf[0];
        if (type === 0) {
          const head = this.take(4);
          if (!head) return;
          this.rectsLeft = readU16(head, 2);
          this.stage = "rect";
          continue;
        }
        if (type === 2) {
          this.take(1);
          continue;
        }
        if (type === 3) {
          if (this.buf.length < 8) return;
          const length = readU32(this.buf, 4);
          if (this.buf.length < 8 + length) return;
          this.take(8 + length);
          continue;
        }
        throw new Error("unsupported VNC server message");
      }
      if (this.stage === "rect") {
        if (this.rectsLeft === 0) {
          this.requestUpdate(true);
          this.stage = "server";
          continue;
        }
        const head = this.take(12);
        if (!head) return;
        this.rectX = readU16(head, 0);
        this.rectY = readU16(head, 2);
        this.rectW = readU16(head, 4);
        this.rectH = readU16(head, 6);
        if (readI32(head, 8) !== 0) throw new Error("unsupported VNC encoding");
        this.rawLeft = this.rectW * this.rectH * 4;
        this.raw = new Uint8Array(this.rawLeft);
        this.rawFilled = 0;
        this.stage = "raw";
        continue;
      }
      const available = Math.min(this.rawLeft, this.buf.length);
      if (available === 0) return;
      this.raw.set(this.buf.subarray(0, available), this.rawFilled);
      this.buf = this.buf.subarray(available);
      this.rawFilled += available;
      this.rawLeft -= available;
      if (this.rawLeft === 0) {
        this.blit();
        this.rectsLeft -= 1;
        this.stage = "rect";
      }
    }
  }

  private blit(): void {
    if (!this.ctx || this.rectW < 1 || this.rectH < 1) return;
    const image = this.ctx.createImageData(this.rectW, this.rectH);
    for (let i = 0, pixel = 0; i < this.raw.length; i += 4, pixel += 4) {
      image.data[pixel] = this.raw[i] ?? 0;
      image.data[pixel + 1] = this.raw[i + 1] ?? 0;
      image.data[pixel + 2] = this.raw[i + 2] ?? 0;
      image.data[pixel + 3] = 255;
    }
    this.ctx.putImageData(image, this.rectX, this.rectY);
  }

  private requestUpdate(incremental: boolean): void {
    const msg = new Uint8Array(10);
    msg[0] = 3;
    msg[1] = incremental ? 1 : 0;
    writeU16(msg, 6, this.width);
    writeU16(msg, 8, this.height);
    this.sendBytes(msg);
  }

  private take(size: number): Uint8Array | null {
    if (this.buf.length < size) return null;
    const out = this.buf.subarray(0, size);
    this.buf = this.buf.subarray(size);
    return out;
  }

  private fail(message: string): void {
    this.stage = "failed";
    this.onError(message);
  }
}

function pixelFormatMessage(): Uint8Array {
  const msg = new Uint8Array(20);
  msg[4] = 32;
  msg[5] = 24;
  msg[7] = 1;
  msg[9] = 255;
  msg[11] = 255;
  msg[13] = 255;
  msg[15] = 8;
  msg[16] = 16;
  return msg;
}

function rawEncodingMessage(): Uint8Array {
  const msg = new Uint8Array(8);
  msg[0] = 2;
  msg[3] = 1;
  return msg;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >> 8) & 0xff;
  target[offset + 1] = value & 0xff;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readU16(source: Uint8Array, offset: number): number {
  return ((source[offset] ?? 0) << 8) | (source[offset + 1] ?? 0);
}

function readU32(source: Uint8Array, offset: number): number {
  return (
    ((source[offset] ?? 0) * 0x1000000 +
      ((source[offset + 1] ?? 0) << 16) +
      ((source[offset + 2] ?? 0) << 8) +
      (source[offset + 3] ?? 0)) >>>
    0
  );
}

function readI32(source: Uint8Array, offset: number): number {
  const value = readU32(source, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
