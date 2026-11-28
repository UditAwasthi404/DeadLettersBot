import { randomBytes, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { BrowserEndpoint, ExecResult, VMInfo, VMManager, VMStats } from "@agentos/vm-manager";
import WebSocket, { WebSocketServer } from "ws";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_COMMANDS = 128;
const MAX_COMMAND_ARGUMENT_LENGTH = 16_384;
const BROWSER_CONNECT_TIMEOUT_MS = 5_000;

type ExecuteRequest = { vmId: string; cmd: string[]; input?: string };
type BrowserRoute = { vmId: string; botId: string; basePath: string; suffix: string };

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function readBoundedBody(request: IncomingMessage): Promise<Uint8Array> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES)
    throw new RequestError(413, "request body too large");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Uint8Array.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_REQUEST_BYTES) throw new RequestError(413, "request body too large");
    chunks.push(bytes);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseExecuteRequest(value: unknown): ExecuteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError(400, "invalid execution request");
  const request = value as Record<string, unknown>;
  if (typeof request.vmId !== "string" || request.vmId.length < 1 || request.vmId.length > 256)
    throw new RequestError(400, "invalid vmId");
  if (
    !Array.isArray(request.cmd) ||
    request.cmd.length < 1 ||
    request.cmd.length > MAX_COMMANDS ||
    request.cmd.some(
      (argument) => typeof argument !== "string" || argument.length > MAX_COMMAND_ARGUMENT_LENGTH,
    )
  )
    throw new RequestError(400, "cmd must be a bounded array of strings");
  if (request.input !== undefined && typeof request.input !== "string")
    throw new RequestError(400, "input must be a string");
  return {
    vmId: request.vmId,
    cmd: request.cmd as string[],
    ...(typeof request.input === "string" ? { input: request.input } : {}),
  };
}

function isAuthorized(request: IncomingMessage, token: Uint8Array): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const supplied = Uint8Array.from(Buffer.from(authorization.slice(7)));
  return supplied.byteLength === token.byteLength && timingSafeEqual(supplied, token);
}

/** Close codes 1005/1006 (and other reserved values) must not be sent in a close frame. */
function safeWsCloseCode(code: number): number | undefined {
  if (!Number.isInteger(code)) return undefined;
  if (code === 1005 || code === 1006 || code === 1015) return undefined;
  if (code < 1000 || code > 4999) return undefined;
  if (code >= 1016 && code <= 2999) return undefined;
  return code;
}

function parseBrowserRoute(pathname: string): BrowserRoute | null {
  // Playwright's connectOverCDP probes `/json/version/` (trailing slash). Drop empty
  // path segments so that still matches the daemon's `/json/version` handler.
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "v1" || segments[1] !== "browser" || segments.length < 3) return null;
  let vmId: string;
  let botId: string;
  try {
    vmId = decodeURIComponent(segments[2] ?? "");
    botId = decodeURIComponent(segments[3] ?? "");
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9_.-]{1,256}$/.test(vmId) || !/^[0-9a-f-]{36}$/i.test(botId)) return null;
  const rest = segments.slice(4);
  return {
    vmId,
    botId,
    basePath: `/v1/browser/${segments[2]}/${segments[3]}`,
    suffix: rest.length > 0 ? `/${rest.join("/")}` : "",
  };
}

async function readBrowserTarget(
  vm: VMManager,
  vmId: string,
  botId: string,
): Promise<{ ipAddress: string; port: number }> {
  let info = await vm.getVMStatus(vmId);
  if (info.status !== "running") info = await vm.wakeVM(vmId);
  if (info.status !== "running") throw new Error("VM is not running");
  const port = await vm.ensureBotBrowser(vmId, botId);
  info = await vm.getVMStatus(vmId);
  if (!info.ipAddress) throw new Error("VM browser is not reachable");
  return { ipAddress: info.ipAddress, port };
}

async function waitForOpen(socket: WebSocket, clientSocket: import("node:stream").Duplex) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      clientSocket.off("close", onClientClose);
      socket.off("open", onOpen);
      socket.off("close", onSocketClose);
      socket.off("error", onSocketError);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.terminate();
      reject(err);
    };
    const onClientClose = () => fail(new Error("browser client disconnected"));
    const onSocketClose = () => fail(new Error("browser connection closed before opening"));
    const onSocketError = (err: Error) => fail(err);
    const onOpen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const timer = setTimeout(
      () => fail(new Error("browser connection timed out")),
      BROWSER_CONNECT_TIMEOUT_MS,
    );
    clientSocket.once("close", onClientClose);
    socket.once("open", onOpen);
    socket.once("close", onSocketClose);
    socket.once("error", onSocketError);
  });
}

class ExecutionDaemonVMManager implements VMManager {
  constructor(
    private readonly inner: VMManager,
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  provisionVM(accountId: string): Promise<VMInfo> {
    return this.inner.provisionVM(accountId);
  }
  wakeVM(vmId: string): Promise<VMInfo> {
    return this.inner.wakeVM(vmId);
  }
  suspendVM(vmId: string): Promise<void> {
    return this.inner.suspendVM(vmId);
  }
  terminateVM(vmId: string): Promise<void> {
    return this.inner.terminateVM(vmId);
  }
  getVMStatus(vmId: string): Promise<VMInfo> {
    return this.inner.getVMStatus(vmId);
  }
  listVMs(): Promise<VMInfo[]> {
    return this.inner.listVMs();
  }
  getVMStats(vmId: string): Promise<VMStats | undefined> {
    return this.inner.getVMStats(vmId);
  }

  async execInContainer(
    vmId: string,
    cmd: string[],
    input?: string,
    signal?: AbortSignal,
  ): Promise<ExecResult> {
    try {
      const response = await fetch(`${this.endpoint}/v1/execute`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ vmId, cmd, ...(input !== undefined ? { input } : {}) }),
        signal,
      });
      const body = (await response.json()) as Partial<ExecResult> & { error?: string };
      if (!response.ok)
        throw new Error(body.error || `execution daemon returned ${response.status}`);
      if (
        typeof body.stdout !== "string" ||
        typeof body.stderr !== "string" ||
        typeof body.exitCode !== "number"
      )
        throw new Error("execution daemon returned an invalid result");
      return {
        stdout: body.stdout,
        stderr: body.stderr,
        exitCode: body.exitCode,
        ...(body.outputTruncated ? { outputTruncated: true } : {}),
      };
    } catch (err) {
      if (signal?.aborted) return { stdout: "", stderr: "execution cancelled", exitCode: 130 };
      throw err;
    }
  }

  ensureBotBrowser(vmId: string, botId: string): Promise<number> {
    return this.inner.ensureBotBrowser(vmId, botId);
  }
  ensureBotVnc(vmId: string, botId: string): Promise<number> {
    return this.inner.ensureBotVnc(vmId, botId);
  }
  watchFiles(
    vmId: string,
    path: string,
    onEvent: (file: string) => void,
  ): Promise<{ stop: () => Promise<void>; done: Promise<void> }> {
    return this.inner.watchFiles(vmId, path, onEvent);
  }
  getBotBrowserEndpoint(vmId: string, botId: string): BrowserEndpoint {
    return {
      url: `${this.endpoint}/v1/browser/${encodeURIComponent(vmId)}/${encodeURIComponent(botId)}`,
      headers: { authorization: `Bearer ${this.token}` },
    };
  }
}

/** Start a loopback-only authenticated execution daemon and per-bot CDP window router. */
export async function startExecutionDaemon(
  vm: VMManager,
): Promise<{ vm: VMManager; port: number; close: () => void }> {
  const secret = randomBytes(32).toString("hex");
  const token = Uint8Array.from(Buffer.from(secret));
  let daemonPort = 0;
  const server = createServer((request, response) => {
    void (async () => {
      if (!isAuthorized(request, token)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const abort = new AbortController();
      request.once("aborted", () => abort.abort());
      response.once("close", () => {
        if (!response.writableEnded) abort.abort();
      });
      try {
        if (request.method === "POST" && url.pathname === "/v1/execute") {
          const bytes = await readBoundedBody(request);
          let decoded: unknown;
          try {
            decoded = JSON.parse(new TextDecoder().decode(bytes));
          } catch {
            throw new RequestError(400, "invalid JSON body");
          }
          const input = parseExecuteRequest(decoded);
          const result = await vm.execInContainer(input.vmId, input.cmd, input.input, abort.signal);
          writeJson(response, 200, result);
          return;
        }
        const browser = parseBrowserRoute(url.pathname);
        if (request.method === "GET" && browser?.suffix === "/json/version") {
          const target = await readBrowserTarget(vm, browser.vmId, browser.botId);
          const upstream = await fetch(`http://${target.ipAddress}:${target.port}/json/version`, {
            signal: AbortSignal.timeout(BROWSER_CONNECT_TIMEOUT_MS),
          });
          if (!upstream.ok) throw new Error("browser endpoint did not respond");
          const version = (await upstream.json()) as Record<string, unknown>;
          if (typeof version.webSocketDebuggerUrl !== "string")
            throw new Error("browser endpoint omitted its WebSocket URL");
          const remoteSocket = new URL(version.webSocketDebuggerUrl);
          if (
            remoteSocket.protocol !== "ws:" ||
            !remoteSocket.pathname.startsWith("/devtools/browser/")
          )
            throw new Error("browser endpoint returned an invalid WebSocket URL");
          version.webSocketDebuggerUrl = `ws://127.0.0.1:${daemonPort}${browser.basePath}${remoteSocket.pathname}${remoteSocket.search}`;
          writeJson(response, 200, version);
          return;
        }
        writeJson(response, 404, { error: "not found" });
      } catch (err) {
        if (abort.signal.aborted || response.destroyed) return;
        writeJson(response, err instanceof RequestError ? err.status : 502, {
          error: err instanceof RequestError ? err.message : "execution daemon request failed",
        });
      }
    })();
  });

  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_REQUEST_BYTES,
    perMessageDeflate: false,
  });
  const upstreamSockets = new Set<WebSocket>();
  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      if (!isAuthorized(request, token)) throw new RequestError(401, "unauthorized");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const browser = parseBrowserRoute(url.pathname);
      if (!browser || !browser.suffix.startsWith("/devtools/browser/"))
        throw new RequestError(404, "not found");
      const target = await readBrowserTarget(vm, browser.vmId, browser.botId);
      const upstreamUrl = `ws://${target.ipAddress}:${target.port}${browser.suffix}${url.search}`;
      const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: BROWSER_CONNECT_TIMEOUT_MS });
      upstreamSockets.add(upstream);
      socket.once("close", () => upstream.terminate());
      try {
        await waitForOpen(upstream, socket);
      } catch (err) {
        upstreamSockets.delete(upstream);
        throw err;
      }
      if (socket.destroyed) {
        upstream.terminate();
        return;
      }
      websocketServer.handleUpgrade(request, socket, head, (client) => {
        client.on("message", (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        });
        upstream.on("message", (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });
        client.on("close", () => {
          if (upstream.readyState === WebSocket.OPEN) upstream.close();
          else upstream.terminate();
        });
        upstream.on("close", (code, reason) => {
          upstreamSockets.delete(upstream);
          if (client.readyState !== WebSocket.OPEN) return;
          const safeCode = safeWsCloseCode(code);
          if (safeCode === undefined) client.close();
          else client.close(safeCode, reason);
        });
        client.on("error", () => upstream.terminate());
        upstream.on("error", () => {
          upstreamSockets.delete(upstream);
          if (client.readyState === WebSocket.OPEN) client.close(1011, "browser connection failed");
        });
      });
    })().catch((err: unknown) => {
      if (!socket.destroyed) {
        const status = err instanceof RequestError ? err.status : 502;
        socket.write(
          `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Bad Gateway"}\r\nConnection: close\r\n\r\n`,
        );
        socket.destroy();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("execution daemon did not bind TCP");
  const port = address.port;
  daemonPort = port;
  const endpoint = `http://127.0.0.1:${port}`;
  let closed = false;
  return {
    vm: new ExecutionDaemonVMManager(vm, endpoint, secret),
    port,
    close: () => {
      if (closed) return;
      closed = true;
      for (const client of websocketServer.clients) client.close(1001, "daemon shutting down");
      for (const upstream of upstreamSockets) upstream.terminate();
      websocketServer.close();
      server.close();
      server.closeAllConnections();
    },
  };
}
