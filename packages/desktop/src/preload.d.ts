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
      send(frame: unknown): Promise<void>;
      disconnect(): Promise<void>;
      connectService(
        baseUrl: string,
        token: string,
        service: "gmail" | "google-calendar" | "google-drive",
      ): Promise<boolean>;
      onFrame(handler: (frame: unknown) => void): () => void;
      onStatus(handler: (status: string) => void): () => void;
    };
  }
}
