/** Raw and CopyRect RFB 3.8 client. Pixels come from the app's gateway socket. */

const CLIENT_VERSION = new TextEncoder().encode("RFB 003.008\n");
const FRAME_INTERVAL_MS = 33;

export class RawVncSession {
  private chunks: Uint8Array[] = [];
  private offset = 0;
  private buffered = 0;
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
    | "copy"
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
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateRequest = 0;
  private updateBytes = 0;
  private nextWait = FRAME_INTERVAL_MS;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sendBytes: (bytes: Uint8Array) => void,
    private readonly onError: (message: string) => void = () => {},
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false });
  }

  push(chunk: Uint8Array): void {
    if (this.stage === "failed" || chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    this.buffered += chunk.byteLength;
    try {
      this.pump();
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** Drop a pending frame request when the view closes. */
  dispose(): void {
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = null;
    this.stage = "failed";
  }

  /** Map a browser client point through object-fit:contain letterboxing into framebuffer pixels. */
  mapClientPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    if (this.width < 1 || this.height < 1 || this.stage === "failed") return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const scale = Math.min(rect.width / this.width, rect.height / this.height);
    const drawW = this.width * scale;
    const drawH = this.height * scale;
    const offsetX = (rect.width - drawW) / 2;
    const offsetY = (rect.height - drawH) / 2;
    const localX = clientX - rect.left - offsetX;
    const localY = clientY - rect.top - offsetY;
    if (localX < 0 || localY < 0 || localX > drawW || localY > drawH) return null;
    return {
      x: (localX / drawW) * this.width,
      y: (localY / drawH) * this.height,
    };
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
        this.sendBytes(encodingMessage());
        this.requestUpdate(false);
        this.stage = "server";
        continue;
      }
      if (this.stage === "server") {
        if (this.buffered < 1) return;
        const type = this.peek(0);
        if (type === 0) {
          const head = this.take(4);
          if (!head) return;
          this.rectsLeft = readU16(head, 2);
          this.updateBytes = 0;
          this.stage = "rect";
          continue;
        }
        if (type === 2) {
          this.take(1);
          continue;
        }
        if (type === 3) {
          if (this.buffered < 8) return;
          const length = this.peekU32(4);
          if (this.buffered < 8 + length) return;
          this.take(8 + length);
          continue;
        }
        throw new Error("unsupported VNC server message");
      }
      if (this.stage === "rect") {
        if (this.rectsLeft === 0) {
          this.nextWait = this.updateBytes < 8_192 ? 200 : FRAME_INTERVAL_MS;
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
        const encoding = readI32(head, 8);
        if (encoding === 1) {
          this.stage = "copy";
          continue;
        }
        if (encoding !== 0) throw new Error("unsupported VNC encoding");
        this.rawLeft = this.rectW * this.rectH * 4;
        this.raw = new Uint8Array(this.rawLeft);
        this.rawFilled = 0;
        this.stage = "raw";
        continue;
      }
      if (this.stage === "copy") {
        const src = this.take(4);
        if (!src) return;
        this.copyRect(readU16(src, 0), readU16(src, 2));
        this.updateBytes += this.rectW * this.rectH * 4;
        this.rectsLeft -= 1;
        this.stage = "rect";
        continue;
      }
      if (this.stage !== "raw") throw new Error("unhandled VNC stage");
      if (!this.fillRaw()) return;
      this.blit();
      this.updateBytes += this.raw.byteLength;
      this.rectsLeft -= 1;
      this.stage = "rect";
    }
  }

  private fillRaw(): boolean {
    while (this.rawLeft > 0 && this.chunks.length > 0) {
      const chunk = this.chunks[0];
      if (!chunk) return false;
      const available = chunk.length - this.offset;
      const count = Math.min(available, this.rawLeft);
      this.raw.set(chunk.subarray(this.offset, this.offset + count), this.rawFilled);
      this.offset += count;
      this.rawFilled += count;
      this.rawLeft -= count;
      this.buffered -= count;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return this.rawLeft === 0;
  }

  private blit(): void {
    if (!this.ctx || this.rectW < 1 || this.rectH < 1) return;
    const image = this.ctx.createImageData(this.rectW, this.rectH);
    image.data.set(this.raw.subarray(0, image.data.length));
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
    this.ctx.putImageData(image, this.rectX, this.rectY);
  }

  private copyRect(srcX: number, srcY: number): void {
    if (!this.ctx || this.rectW < 1 || this.rectH < 1) return;
    const image = this.ctx.getImageData(srcX, srcY, this.rectW, this.rectH);
    this.ctx.putImageData(image, this.rectX, this.rectY);
  }

  private requestUpdate(incremental: boolean): void {
    const send = () => {
      this.requestTimer = null;
      if (this.stage === "failed") return;
      this.lastUpdateRequest = performance.now();
      const msg = new Uint8Array(10);
      msg[0] = 3;
      msg[1] = incremental ? 1 : 0;
      writeU16(msg, 6, this.width);
      writeU16(msg, 8, this.height);
      this.sendBytes(msg);
    };
    if (!incremental) {
      if (this.requestTimer) clearTimeout(this.requestTimer);
      this.requestTimer = null;
      send();
      return;
    }
    const wait = Math.max(0, this.nextWait - (performance.now() - this.lastUpdateRequest));
    if (wait === 0) {
      send();
      return;
    }
    if (this.requestTimer) return;
    this.requestTimer = setTimeout(send, wait);
  }

  private peek(index: number): number {
    let left = index;
    for (let chunkIndex = 0; chunkIndex < this.chunks.length; chunkIndex += 1) {
      const chunk = this.chunks[chunkIndex];
      if (!chunk) return 0;
      const start = chunkIndex === 0 ? this.offset : 0;
      const available = chunk.length - start;
      if (left < available) return chunk[start + left] ?? 0;
      left -= available;
    }
    return 0;
  }

  private peekU32(index: number): number {
    return (
      (this.peek(index) * 0x1000000 +
        (this.peek(index + 1) << 16) +
        (this.peek(index + 2) << 8) +
        this.peek(index + 3)) >>>
      0
    );
  }

  private take(size: number): Uint8Array | null {
    if (this.buffered < size) return null;
    const out = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      const chunk = this.chunks[0];
      if (!chunk) return null;
      const available = chunk.length - this.offset;
      const count = Math.min(available, size - filled);
      out.set(chunk.subarray(this.offset, this.offset + count), filled);
      filled += count;
      this.offset += count;
      this.buffered -= count;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return out;
  }

  private fail(message: string): void {
    this.dispose();
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

/** Prefer CopyRect, then raw. CopyRect makes scroll updates a few bytes instead of a full frame. */
function encodingMessage(): Uint8Array {
  const msg = new Uint8Array(12);
  msg[0] = 2;
  msg[3] = 2;
  msg[7] = 1;
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
