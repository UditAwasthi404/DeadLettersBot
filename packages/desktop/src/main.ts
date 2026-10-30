import { join } from "node:path";
import { BrowserWindow, app, ipcMain, session, shell } from "electron";
import { autoUpdater } from "electron-updater";
import WebSocket from "ws";
import { type LocalMachineAccess, runLocalCommand } from "./local-daemon";

const SESSION_URL = "https://session.agentos.desktop";
const RECONNECT_CAP_MS = 30_000;

let windowRef: BrowserWindow | null = null;
let gatewayBase = "";
let bearerToken = "";
let socket: WebSocket | null = null;
let connectionGeneration = 0;
let userDisconnected = true;
let quitting = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let vncSocket: WebSocket | null = null;
let vncEpoch = 0;
const localPolicy = new Map<string, LocalMachineAccess>();
const sessionAllow = new Set<string>();
const pendingLocal = new Map<string, (decision: "allow" | "deny" | "allow_session") => void>();

function sendGateway(frame: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(frame));
}

function localResult(
  runId: string,
  actionId: string,
  stdout: string,
  stderr: string,
  exitCode: number,
): void {
  sendGateway({ type: "localExecResult", runId, actionId, stdout, stderr, exitCode });
}

function createWindow(): void {
  windowRef = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: "#101114",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl =
    process.env.VITE_DEV_SERVER_URL ?? (!app.isPackaged ? "http://127.0.0.1:5173" : undefined);
  if (devUrl) void windowRef.loadURL(devUrl);
  else void windowRef.loadFile(join(__dirname, "../dist/index.html"));
  windowRef.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  windowRef.webContents.on("will-navigate", (event, url) => {
    const allowed =
      process.env.VITE_DEV_SERVER_URL ?? (!app.isPackaged ? "http://127.0.0.1:5173" : "file://");
    if (!url.startsWith(allowed)) event.preventDefault();
  });
  windowRef.on("closed", () => {
    windowRef = null;
  });
}

function sendStatus(status: string): void {
  windowRef?.webContents.send("gateway:status", status);
}

function clearReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

async function persistSession(baseUrl: string, token: string): Promise<void> {
  await session.defaultSession.cookies.set({
    url: SESSION_URL,
    name: "gateway",
    value: encodeURIComponent(JSON.stringify({ baseUrl, token })),
    secure: true,
    httpOnly: true,
    sameSite: "strict",
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  });
}

async function readSession(): Promise<{ baseUrl: string; token: string } | null> {
  const cookies = await session.defaultSession.cookies.get({ url: SESSION_URL, name: "gateway" });
  const raw = cookies[0]?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { baseUrl?: string; token?: string };
    if (!parsed.baseUrl || !parsed.token) return null;
    return { baseUrl: parsed.baseUrl, token: parsed.token };
  } catch {
    return null;
  }
}

function scheduleReconnect(generation: number): void {
  if (userDisconnected || quitting || generation !== connectionGeneration) return;
  clearReconnect();
  const delay = Math.min(RECONNECT_CAP_MS, 500 * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    if (userDisconnected || quitting || generation !== connectionGeneration) return;
    openSocket(generation);
  }, delay);
}

function openSocket(generation: number): void {
  if (!gatewayBase || !bearerToken || userDisconnected || quitting) return;
  const base = new URL(gatewayBase);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws";
  base.search = "";
  base.hash = "";
  const previous = socket;
  socket = null;
  previous?.removeAllListeners();
  previous?.close();
  socket = new WebSocket(base, { headers: { Authorization: `Bearer ${bearerToken}` } });
  socket.on("open", () => {
    if (generation !== connectionGeneration) return;
    reconnectAttempt = 0;
    sendStatus("connected");
  });
  socket.on("close", () => {
    if (generation !== connectionGeneration) return;
    sendStatus("disconnected");
    scheduleReconnect(generation);
  });
  socket.on("error", (err) => {
    if (generation !== connectionGeneration) return;
    sendStatus(err.message);
  });
  socket.on("message", (data) => {
    try {
      const frame = JSON.parse(data.toString()) as { type?: string };
      if (frame.type === "localExecRequest") {
        enqueueLocalExec(frame as LocalExecRequest);
        return;
      }
      windowRef?.webContents.send("gateway:frame", frame);
    } catch {
      sendStatus("Received an unreadable gateway frame");
    }
  });
}

interface LocalExecRequest {
  type: "localExecRequest";
  agentId: string;
  runId: string;
  actionId: string;
  command: string;
  cwd?: string;
}

let localChain: Promise<void> = Promise.resolve();

function enqueueLocalExec(frame: LocalExecRequest): void {
  // shortcut: the connected desktop is the only local machine. Route by machine id when a second daemon exists.
  localChain = localChain.then(() => handleLocalExecRequest(frame)).catch(() => undefined);
}

async function handleLocalExecRequest(frame: LocalExecRequest): Promise<void> {
  const policy = sessionAllow.has(frame.agentId)
    ? "always_allow"
    : (localPolicy.get(frame.agentId) ?? "always_confirm");
  if (policy === "never") {
    localResult(frame.runId, frame.actionId, "", "local execution disabled", 1);
    return;
  }
  if (policy !== "always_allow") {
    const decision = await new Promise<"allow" | "deny" | "allow_session">((resolve) => {
      const key = `${frame.runId}:${frame.actionId}`;
      const timer = setTimeout(() => {
        pendingLocal.delete(key);
        resolve("deny");
      }, 55_000);
      pendingLocal.set(key, (choice) => {
        clearTimeout(timer);
        resolve(choice);
      });
      windowRef?.webContents.send("local:execRequest", frame);
    });
    if (decision === "deny") {
      localResult(frame.runId, frame.actionId, "", "local execution blocked", 1);
      return;
    }
    if (decision === "allow_session") sessionAllow.add(frame.agentId);
  }
  try {
    const result = await runLocalCommand(frame.command, frame.cwd, "always_allow");
    localResult(frame.runId, frame.actionId, result.stdout, result.stderr, result.exitCode);
  } catch (err) {
    localResult(
      frame.runId,
      frame.actionId,
      "",
      err instanceof Error ? err.message : String(err),
      1,
    );
  }
}

function allowedOAuthHost(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "accounts.google.com" ||
      url.hostname === "login.microsoftonline.com" ||
      url.hostname === "login.salesforce.com")
  );
}

ipcMain.handle(
  "api:request",
  async (
    _event,
    request: { baseUrl: string; token: string; path: string; method?: string; body?: unknown },
  ) => {
    const base = new URL(request.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || !request.path.startsWith("/v1/"))
      throw new Error("invalid API request");
    gatewayBase = base.origin;
    bearerToken = request.token;
    const response = await fetch(new URL(request.path, gatewayBase), {
      method: request.method ?? "GET",
      headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok)
      throw new Error(
        typeof data === "object" && data !== null && "error" in data
          ? String(data.error)
          : `HTTP ${response.status}`,
      );
    return data;
  },
);

ipcMain.handle("gateway:connect", async (_event, baseUrl: string, token: string) => {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("invalid gateway URL");
  gatewayBase = base.origin;
  bearerToken = token;
  userDisconnected = false;
  reconnectAttempt = 0;
  clearReconnect();
  connectionGeneration += 1;
  await persistSession(gatewayBase, bearerToken);
  openSocket(connectionGeneration);
  return true;
});

ipcMain.handle("gateway:restore", async () => readSession());

ipcMain.handle("gateway:send", (_event, frame: unknown) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("gateway is not connected");
  socket.send(JSON.stringify(frame));
});
function stopVnc(): void {
  vncEpoch += 1;
  const current = vncSocket;
  vncSocket = null;
  current?.removeAllListeners();
  current?.close();
}

ipcMain.handle("vnc:open", (_event, botId: string) => {
  if (!gatewayBase || !bearerToken) throw new Error("gateway is not connected");
  if (!/^[0-9a-f-]{36}$/i.test(botId)) throw new Error("invalid bot id");
  stopVnc();
  const epoch = vncEpoch;
  const url = new URL(gatewayBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/vnc";
  url.search = "";
  url.searchParams.set("botId", botId);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean, err?: Error) => {
      if (settled) return;
      settled = true;
      if (ok) resolve(true);
      else reject(err ?? new Error("vnc closed"));
    };
    const sock = new WebSocket(url, { headers: { Authorization: `Bearer ${bearerToken}` } });
    sock.on("open", () => {
      if (epoch !== vncEpoch) {
        sock.close();
        finish(false);
        return;
      }
      vncSocket = sock;
      finish(true);
    });
    sock.on("message", (data) => {
      if (epoch !== vncEpoch) return;
      const bytes = Buffer.isBuffer(data)
        ? new Uint8Array(data)
        : new TextEncoder().encode(String(data));
      windowRef?.webContents.send("vnc:data", bytes);
    });
    sock.on("close", () => {
      finish(false);
      if (epoch !== vncEpoch) return;
      vncSocket = null;
      windowRef?.webContents.send("vnc:status", "closed");
    });
    sock.on("error", () => {
      finish(false, new Error("vnc failed"));
    });
  });
});
ipcMain.handle("vnc:send", (_event, bytes: Uint8Array) => {
  if (!vncSocket || vncSocket.readyState !== WebSocket.OPEN) return;
  vncSocket.send(Buffer.from(bytes));
});
ipcMain.handle("vnc:close", () => {
  stopVnc();
});

ipcMain.handle("app:restart", () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle("local:setPolicy", (_event, botId: string, policy: LocalMachineAccess) => {
  if (!botId) return;
  if (policy !== "never" && policy !== "always_confirm" && policy !== "always_allow") return;
  localPolicy.set(botId, policy);
});
ipcMain.handle("local:exec", (_event, cmd: string, cwd?: string, policy?: LocalMachineAccess) =>
  runLocalCommand(String(cmd ?? ""), cwd, policy),
);
ipcMain.handle(
  "local:execReply",
  (_event, decision: string, frame: { runId?: string; actionId?: string }) => {
    const resolve = pendingLocal.get(`${frame?.runId}:${frame?.actionId}`);
    pendingLocal.delete(`${frame?.runId}:${frame?.actionId}`);
    if (decision === "allow" || decision === "allow_session" || decision === "deny")
      resolve?.(decision);
    else resolve?.("deny");
  },
);

ipcMain.handle("gateway:disconnect", () => {
  userDisconnected = true;
  connectionGeneration += 1;
  clearReconnect();
  socket?.close();
  socket = null;
});

ipcMain.handle(
  "connector:connect",
  async (
    _event,
    baseUrl: string,
    token: string,
    service: "gmail" | "google-calendar" | "google-drive" | "microsoft" | "salesforce",
  ) => {
    if (!["gmail", "google-calendar", "google-drive", "microsoft", "salesforce"].includes(service))
      throw new Error("unsupported connector");
    const base = new URL(baseUrl);
    const response = await fetch(new URL(`/v1/connectors/oauth/start/${service}`, base.origin), {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    const destination = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !destination)
      throw new Error(`OAuth start failed: HTTP ${response.status}`);
    const oauthUrl = new URL(destination);
    if (!allowedOAuthHost(oauthUrl)) throw new Error("OAuth provider returned an unexpected URL");
    await shell.openExternal(oauthUrl.toString());
    return true;
  },
);

app.whenReady().then(() => {
  createWindow();
  // shortcut: GitHub publish owner/repo are placeholders until a release channel exists.
  if (app.isPackaged) {
    autoUpdater.on("update-available", () => {
      windowRef?.webContents.send("update:available");
    });
    autoUpdater.on("update-downloaded", () => {
      windowRef?.webContents.send("update:ready");
    });
    void autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.warn("[desktop] update check failed", err);
    });
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  quitting = true;
  userDisconnected = true;
  clearReconnect();
  stopVnc();
  for (const resolve of pendingLocal.values()) resolve("deny");
  pendingLocal.clear();
  socket?.close();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
