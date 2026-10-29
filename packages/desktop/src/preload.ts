import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agentOS", {
  apiRequest: (request: {
    baseUrl: string;
    token: string;
    path: string;
    method?: string;
    body?: unknown;
  }) => ipcRenderer.invoke("api:request", request),
  connect: (baseUrl: string, token: string) =>
    ipcRenderer.invoke("gateway:connect", baseUrl, token),
  send: (frame: unknown) => ipcRenderer.invoke("gateway:send", frame),
  disconnect: () => ipcRenderer.invoke("gateway:disconnect"),
  connectService: (
    baseUrl: string,
    token: string,
    service: "gmail" | "google-calendar" | "google-drive",
  ) => ipcRenderer.invoke("connector:connect", baseUrl, token, service),
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
