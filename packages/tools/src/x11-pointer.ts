/** Move the X cursor from Node, so old VM images do not need xdotool baked in. */

export function warpPointerPacket(root: number, x: number, y: number): Buffer {
  const buf = Buffer.alloc(24);
  buf[0] = 41;
  buf.writeUInt16LE(6, 2);
  buf.writeUInt32LE(0, 4);
  buf.writeUInt32LE(root >>> 0, 8);
  buf.writeInt16LE(Math.round(x), 20);
  buf.writeInt16LE(Math.round(y), 22);
  return buf;
}

/** First root window id in an X11 setup reply, or null when the reply is not usable. */
export function rootWindowFromSetup(setup: Buffer): number | null {
  if (setup.length < 40 || setup[0] !== 1) return null;
  const body = 8;
  const vendorLen = setup.readUInt16LE(body + 16);
  const numFormats = setup[body + 21] ?? 0;
  const offset = body + 32 + ((vendorLen + 3) & ~3) + numFormats * 8;
  if (offset + 4 > setup.length) return null;
  const root = setup.readUInt32LE(offset);
  return root > 0 ? root : null;
}

export const X11_POINTER_SCRIPT = `const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { connect } = require("node:net");
const { homedir } = require("node:os");

const botId = process.argv[1] ?? "";
const x = Number(process.argv[2]);
const y = Number(process.argv[3]);
if (!/^[0-9a-fA-F-]{36}$/.test(botId) || !Number.isFinite(x) || !Number.isFinite(y)) {
  console.error("invalid pointer request");
  process.exit(2);
}
const home = process.env.HOME || homedir();
const mappingPath = home + "/.agentos/browsers/" + botId;
if (!existsSync(mappingPath)) {
  console.error("browser display is not running");
  process.exit(1);
}
const display = readFileSync(mappingPath, "utf8").trim().split(/\\s+/)[1] ?? "";
if (!/^[0-9]+$/.test(display)) {
  console.error("browser display is not running");
  process.exit(1);
}
const env = { ...process.env, DISPLAY: ":" + display };
const moved = spawnSync("xdotool", ["mousemove", "--sync", String(Math.round(x)), String(Math.round(y))], { env });
if (moved.status === 0) process.exit(0);

const cookie = readCookie(display);
const socketPath = "/tmp/.X11-unix/X" + display;
const client = connect(socketPath);
const chunks = [];
client.on("data", (chunk) => chunks.push(chunk));
client.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
client.on("connect", () => {
  const name = Buffer.from(cookie?.name ?? "");
  const data = cookie?.data ?? Buffer.alloc(0);
  const hello = Buffer.alloc(12 + pad4(name.length) + pad4(data.length));
  hello[0] = 0x6c;
  hello.writeUInt16LE(11, 2);
  hello.writeUInt16LE(name.length, 6);
  hello.writeUInt16LE(data.length, 8);
  name.copy(hello, 12);
  data.copy(hello, 12 + pad4(name.length));
  client.write(hello);
});
client.on("end", () => finish(Buffer.concat(chunks)));

function finish(setup) {
  if (setup[0] !== 1) {
    console.error("X display refused the pointer connection");
    process.exit(1);
  }
  const root = rootOf(setup);
  if (!root) {
    console.error("X display has no root window");
    process.exit(1);
  }
  const packet = Buffer.alloc(24);
  packet[0] = 41;
  packet.writeUInt16LE(6, 2);
  packet.writeUInt32LE(root, 8);
  packet.writeInt16LE(Math.max(0, Math.min(7680, Math.round(x))), 20);
  packet.writeInt16LE(Math.max(0, Math.min(4320, Math.round(y))), 22);
  const again = connect(socketPath);
  again.on("error", (err) => {
    console.error(err.message);
    process.exit(1);
  });
  again.on("connect", () => {
    const name = Buffer.from(cookie?.name ?? "");
    const data = cookie?.data ?? Buffer.alloc(0);
    const hello = Buffer.alloc(12 + pad4(name.length) + pad4(data.length));
    hello[0] = 0x6c;
    hello.writeUInt16LE(11, 2);
    hello.writeUInt16LE(name.length, 6);
    hello.writeUInt16LE(data.length, 8);
    name.copy(hello, 12);
    data.copy(hello, 12 + pad4(name.length));
    again.write(Buffer.concat([hello, packet]));
    setTimeout(() => {
      again.end();
      process.exit(0);
    }, 40);
  });
}

function rootOf(setup) {
  const body = 8;
  if (setup.length < body + 32) return 0;
  const vendorLen = setup.readUInt16LE(body + 16);
  const formats = setup[body + 21] ?? 0;
  const offset = body + 32 + ((vendorLen + 3) & ~3) + formats * 8;
  if (offset + 4 > setup.length) return 0;
  return setup.readUInt32LE(offset);
}

function readCookie(displayNum) {
  const path = process.env.XAUTHORITY || home + "/.Xauthority";
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  let i = 0;
  while (i + 8 < buf.length) {
    const family = buf.readUInt16BE(i); i += 2;
    const addressLen = buf.readUInt16BE(i); i += 2;
    if (i + addressLen > buf.length) return null;
    i += addressLen;
    const numberLen = buf.readUInt16BE(i); i += 2;
    const number = buf.subarray(i, i + numberLen).toString(); i += numberLen;
    const nameLen = buf.readUInt16BE(i); i += 2;
    const name = buf.subarray(i, i + nameLen).toString(); i += nameLen;
    const dataLen = buf.readUInt16BE(i); i += 2;
    const data = buf.subarray(i, i + dataLen); i += dataLen;
    if ((family === 256 || family === 65535) && number === String(displayNum)) return { name, data };
  }
  return null;
}

function pad4(length) {
  return (length + 3) & ~3;
}
`;
