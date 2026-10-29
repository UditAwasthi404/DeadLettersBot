import { join } from "node:path";
import { BrowserWindow, app, ipcMain, shell } from "electron";
import WebSocket from "ws";

let windowRef: BrowserWindow | null = null;
let gatewayBase = "";
let bearerToken = "";
let socket: WebSocket | null = null;

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
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws";
  base.search = "";
  base.hash = "";
  gatewayBase = new URL(baseUrl).origin;
  bearerToken = token;
  socket?.close();
  socket = new WebSocket(base, { headers: { Authorization: `Bearer ${token}` } });
  socket.on("open", () => windowRef?.webContents.send("gateway:status", "connected"));
  socket.on("close", () => windowRef?.webContents.send("gateway:status", "disconnected"));
  socket.on("error", (err) => windowRef?.webContents.send("gateway:status", err.message));
  socket.on("message", (data) => {
    try {
      windowRef?.webContents.send("gateway:frame", JSON.parse(data.toString()));
    } catch {
      windowRef?.webContents.send("gateway:status", "Received an unreadable gateway frame");
    }
  });
  return true;
});

ipcMain.handle("gateway:send", (_event, frame: unknown) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("gateway is not connected");
  socket.send(JSON.stringify(frame));
});
ipcMain.handle("gateway:disconnect", () => {
  socket?.close();
  socket = null;
});

ipcMain.handle(
  "connector:connect",
  async (
    _event,
    baseUrl: string,
    token: string,
    service: "gmail" | "google-calendar" | "google-drive",
  ) => {
    if (!["gmail", "google-calendar", "google-drive"].includes(service))
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
    if (oauthUrl.hostname !== "accounts.google.com" || oauthUrl.protocol !== "https:")
      throw new Error("OAuth provider returned an unexpected URL");
    await shell.openExternal(oauthUrl.toString());
    return true;
  },
);

app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => socket?.close());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
