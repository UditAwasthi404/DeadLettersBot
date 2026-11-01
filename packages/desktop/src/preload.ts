import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agentOS", {
  platform: process.platform,
  apiRequest: (request: {
    baseUrl: string;
    token: string;
    path: string;
    method?: string;
    body?: unknown;
  }) => ipcRenderer.invoke("api:request", request),
  connect: (baseUrl: string, token: string) =>
    ipcRenderer.invoke("gateway:connect", baseUrl, token),
  updateToken: (token: string) => ipcRenderer.invoke("gateway:updateToken", token),
  restoreSession: () =>
    ipcRenderer.invoke("gateway:restore") as Promise<{ baseUrl: string; token: string } | null>,
  send: (frame: unknown) => ipcRenderer.invoke("gateway:send", frame),
  disconnect: () => ipcRenderer.invoke("gateway:disconnect"),
  openVnc: (botId: string) => ipcRenderer.invoke("vnc:open", botId),
  sendVnc: (bytes: Uint8Array) => ipcRenderer.invoke("vnc:send", bytes),
  closeVnc: () => ipcRenderer.invoke("vnc:close"),
  onVncData: (handler: (bytes: Uint8Array) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, bytes: Uint8Array) => handler(bytes);
    ipcRenderer.on("vnc:data", listener);
    return () => ipcRenderer.removeListener("vnc:data", listener);
  },
  onVncStatus: (handler: (status: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: string) => handler(status);
    ipcRenderer.on("vnc:status", listener);
    return () => ipcRenderer.removeListener("vnc:status", listener);
  },
  connectService: (
    baseUrl: string,
    token: string,
    service: "gmail" | "google-calendar" | "google-drive" | "microsoft" | "salesforce",
  ) => ipcRenderer.invoke("connector:connect", baseUrl, token, service),
  setLocalPolicy: (botId: string, policy: "never" | "always_confirm" | "always_allow") =>
    ipcRenderer.invoke("local:setPolicy", botId, policy),
  onLocalExec: (handler: (frame: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: unknown) => handler(frame);
    ipcRenderer.on("local:execRequest", listener);
    return () => ipcRenderer.removeListener("local:execRequest", listener);
  },
  replyLocalExec: (decision: "allow" | "deny" | "allow_session", frame: unknown) =>
    ipcRenderer.invoke("local:execReply", decision, frame),
  onUpdateAvailable: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("update:available", listener);
    return () => ipcRenderer.removeListener("update:available", listener);
  },
  onUpdateReady: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("update:ready", listener);
    return () => ipcRenderer.removeListener("update:ready", listener);
  },
  restartToUpdate: () => ipcRenderer.invoke("app:restart"),
  onFrame: (handler: (frame: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: unknown) => handler(frame);
    ipcRenderer.on("gateway:frame", listener);
    return () => ipcRenderer.removeListener("gateway:frame", listener);
  },
  onStatus: (handler: (status: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: string) => handler(status);
    ipcRenderer.on("gateway:status", listener);
    return () => ipcRenderer.removeListener("gateway:status", listener);
  },
});
