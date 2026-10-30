export {};

declare global {
  interface Window {
    agentOS: {
      apiRequest(request: {
        baseUrl: string;
        token: string;
        path: string;
        method?: string;
        body?: unknown;
      }): Promise<unknown>;
      connect(baseUrl: string, token: string): Promise<boolean>;
      restoreSession(): Promise<{ baseUrl: string; token: string } | null>;
      send(frame: unknown): Promise<void>;
      disconnect(): Promise<void>;
      openVnc(botId: string): Promise<boolean>;
      sendVnc(bytes: Uint8Array): Promise<void>;
      closeVnc(): Promise<void>;
      onVncData(handler: (bytes: Uint8Array) => void): () => void;
      onVncStatus(handler: (status: string) => void): () => void;
      connectService(
        baseUrl: string,
        token: string,
        service: "gmail" | "google-calendar" | "google-drive" | "microsoft" | "salesforce",
      ): Promise<boolean>;
      setLocalPolicy(
        botId: string,
        policy: "never" | "always_confirm" | "always_allow",
      ): Promise<void>;
      onLocalExec(handler: (frame: unknown) => void): () => void;
      replyLocalExec(decision: "allow" | "deny" | "allow_session", frame: unknown): Promise<void>;
      onUpdateAvailable(handler: () => void): () => void;
      onUpdateReady(handler: () => void): () => void;
      restartToUpdate(): Promise<void>;
      onFrame(handler: (frame: unknown) => void): () => void;
      onStatus(handler: (status: string) => void): () => void;
    };
  }
}
