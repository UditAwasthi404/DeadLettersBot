import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UpdateBanner } from "./UpdateBanner.tsx";
import { RawVncSession } from "./rfb.ts";
import "./style.css";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type LocalPolicy = "never" | "always_confirm" | "always_allow";

interface Bot {
  id: string;
  name: string;
  role: string;
  inferenceSettings?: { providerId?: string; model?: string };
  localMachineAccess?: LocalPolicy;
  retainData?: boolean;
}

function isLocalPolicy(value: string | null | undefined): value is LocalPolicy {
  return value === "never" || value === "always_confirm" || value === "always_allow";
}
interface MemoryEntry {
  id: string;
  scope: "agent" | "user" | "project";
  content: string;
  source: string;
  isUserAuthored: boolean;
  updatedAt: string;
  staleAfter: string | null;
}
interface MemoryEvidenceEntry {
  id: string;
  turnId: string;
  createdAt: string;
}
interface SkillItem {
  id: string;
  ownerBotId: string | null;
  name: string;
  description: string;
  version?: number;
  steps: Array<{
    instruction: string;
    approvalRequired?: boolean;
    onError?: "stop" | "retry" | "skip" | "notify_user" | "custom_prompt";
    maxAttempts?: number;
    customPrompt?: string;
  }>;
}
interface SkillStepDraft {
  instruction: string;
  approvalRequired: boolean;
  onError: "stop" | "retry" | "skip" | "notify_user" | "custom_prompt";
  maxAttempts: number;
  customPrompt: string;
}
interface RoutineItem {
  id: string;
  botId: string;
  skillId: string;
  name: string;
  enabled: boolean;
  trigger:
    | { type: "cron"; schedule?: string }
    | { type: "webhook" }
    | { type: "inter_bot_message"; senderBotId?: string }
    | { type: "file_change"; path?: string };
  lastTriggeredAt: string | null;
  nextRunAt?: string | null;
  cronTimezone?: string | null;
  onError?: "notify_user" | "retry" | "pause";
}
interface RoutineRunItem {
  id: string;
  triggeredAt: string;
  status: string;
  durationMs: number | null;
  inputSummary: string;
  outputSummary: string;
  errorMessage: string | null;
}

function routineTriggerLabel(trigger: RoutineItem["trigger"], bots: Bot[]): string {
  if (trigger.type === "cron") return trigger.schedule ?? "Cron";
  if (trigger.type === "webhook") return "Webhook";
  if (trigger.type === "file_change") return `File change ${trigger.path ?? ""}`.trim();
  const senderName = trigger.senderBotId
    ? (bots.find((bot) => bot.id === trigger.senderBotId)?.name ?? "selected bot")
    : "any bot";
  return `Inter-bot message from ${senderName}`;
}

function cronFieldOk(field: string, min: number, max: number): boolean {
  return field.split(",").every((part) => {
    const [base, step] = part.split("/");
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) return false;
    if (!base || base === "*") return true;
    const pieces = base.split("-");
    return (
      (pieces.length === 1 || pieces.length === 2) &&
      pieces.every((n) => /^\d+$/.test(n) && Number(n) >= min && Number(n) <= max)
    );
  });
}

function gatewayHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "Set a gateway";
  }
}

function isAccountEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  );
}

function cronPreview(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return "Use five fields: minute hour day month weekday.";
  const [minute, hour, day, month, weekday] = fields;
  if (
    !minute ||
    !hour ||
    !day ||
    !month ||
    !weekday ||
    !cronFieldOk(minute, 0, 59) ||
    !cronFieldOk(hour, 0, 23) ||
    !cronFieldOk(day, 1, 31) ||
    !cronFieldOk(month, 1, 12) ||
    !cronFieldOk(weekday, 0, 7)
  )
    return "That expression is not a five-field cron schedule.";
  if (
    minute === "0" &&
    hour &&
    /^\d+$/.test(hour) &&
    day === "*" &&
    month === "*" &&
    weekday === "*"
  )
    return `Daily at ${hour.padStart(2, "0")}:00.`;
  return "Five-field cron schedule.";
}

const CONNECTOR_CARDS = [
  { id: "gmail", label: "Gmail", oauth: "gmail" },
  { id: "google-calendar", label: "Google Calendar", oauth: "google-calendar" },
  { id: "google-drive", label: "Google Drive", oauth: "google-drive" },
  { id: "onedrive", label: "OneDrive", oauth: "microsoft" },
  { id: "outlook-mail", label: "Outlook Mail", oauth: "microsoft" },
  { id: "outlook-calendar", label: "Outlook Calendar", oauth: "microsoft" },
  { id: "teams", label: "Teams", oauth: "microsoft" },
  { id: "sharepoint", label: "SharePoint", oauth: "microsoft" },
  { id: "salesforce", label: "Salesforce", oauth: "salesforce" },
] as const;
interface ConnectorItem {
  service: string;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string;
}
interface McpServerItem {
  id: string;
  name: string;
  url: string;
  cachedTools: Array<{ name: string }>;
  lastHealth: string;
  lastCheckedAt: string | null;
}
type WebhookEventName = "turn.settled" | "routine.completed" | "approval.required";
interface WebhookSubscriptionItem {
  id: string;
  url: string;
  events: WebhookEventName[];
  createdAt: string;
}
interface WebhookDeliveryItem {
  id: string;
  subscriptionId: string;
  event: WebhookEventName;
  status: string;
  attemptCount: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}
interface ChatItem {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  runId?: string;
  agentId?: string;
  toolName?: string;
  approval?: { actionId: string; permissionLevel: number };
}
interface PendingAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uri: string;
}

interface Frame {
  type: string;
  agentId?: string;
  runId?: string;
  reason?: string;
  delta?: string;
  content?: string;
  endTurn?: boolean;
  toolName?: string;
  params?: unknown;
  result?: unknown;
  actionId?: string;
  actionDescription?: string;
  permissionLevel?: number;
  code?: string;
  message?: string;
}

function App() {
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8787");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("disconnected");
  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [activeRun, setActiveRun] = useState("");
  const [error, setError] = useState("");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryEvidence, setMemoryEvidence] = useState<Record<string, MemoryEvidenceEntry[]>>({});
  const [automationOpen, setAutomationOpen] = useState(false);
  const [skillItems, setSkillItems] = useState<SkillItem[]>([]);
  const [editingSkillId, setEditingSkillId] = useState("");
  const [skillDraftName, setSkillDraftName] = useState("");
  const [skillDraftDescription, setSkillDraftDescription] = useState("");
  const [skillDraftSteps, setSkillDraftSteps] = useState<SkillStepDraft[]>([]);
  const [routineItems, setRoutineItems] = useState<RoutineItem[]>([]);
  const [routineHistory, setRoutineHistory] = useState<Record<string, RoutineRunItem[]>>({});
  const [editingRoutineId, setEditingRoutineId] = useState("");
  const [routineDraftName, setRoutineDraftName] = useState("");
  const [routineDraftBotId, setRoutineDraftBotId] = useState("");
  const [routineDraftSkillId, setRoutineDraftSkillId] = useState("");
  const [routineDraftSchedule, setRoutineDraftSchedule] = useState("");
  const [routineDraftSenderBotId, setRoutineDraftSenderBotId] = useState("");
  const [routineDraftPath, setRoutineDraftPath] = useState("/home/agent");
  const [routineDraftOnError, setRoutineDraftOnError] = useState<"notify_user" | "retry" | "pause">(
    "pause",
  );
  const [recording, setRecording] = useState(false);
  const [taughtDraft, setTaughtDraft] = useState<{
    name: string;
    description: string;
    steps: Array<SkillStepDraft & { id: string }>;
  } | null>(null);
  const [skillTests, setSkillTests] = useState<Record<string, { runId: string; status: string }>>(
    {},
  );
  const [routineWebhookSetup, setRoutineWebhookSetup] = useState<{
    url: string;
    secret: string;
  } | null>(null);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventName[]>(["turn.settled"]);
  const [webhookSubscriptions, setWebhookSubscriptions] = useState<WebhookSubscriptionItem[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  const [inferenceProviders, setInferenceProviders] = useState<string[]>([]);
  const [inferenceProviderId, setInferenceProviderId] = useState("");
  const [inferenceModel, setInferenceModel] = useState("");
  const [retainData, setRetainData] = useState(true);
  const [updateReady, setUpdateReady] = useState(false);
  const [skillDragIndex, setSkillDragIndex] = useState<number | null>(null);
  const [connectorItems, setConnectorItems] = useState<ConnectorItem[]>([]);
  const [mcpItems, setMcpItems] = useState<McpServerItem[]>([]);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpApiKey, setMcpApiKey] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLCanvasElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [localOpen, setLocalOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authMode, setAuthMode] = useState<"create" | "token">("create");
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const accountNameRef = useRef<HTMLInputElement>(null);
  const [botQuery, setBotQuery] = useState("");
  const [botDraftOpen, setBotDraftOpen] = useState(false);
  const [botDraftName, setBotDraftName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const botNameRef = useRef<HTMLInputElement>(null);
  const [localAccess, setLocalAccess] = useState<LocalPolicy>("always_confirm");
  const [pendingLocal, setPendingLocal] = useState<{
    agentId: string;
    runId: string;
    actionId: string;
    command: string;
    cwd?: string;
  } | null>(null);
  const [allowLocalSession, setAllowLocalSession] = useState(false);
  const [screenMode, setScreenMode] = useState<null | "view" | "handoff">(null);
  const [handoff, setHandoff] = useState<{
    agentId: string;
    runId: string;
    reason: string;
  } | null>(null);
  const screenBotId = screenMode === "handoff" ? handoff?.agentId : botId;

  useEffect(() => {
    const stopFrame = window.agentOS.onFrame((unknownFrame) => {
      const frame = unknownFrame as Frame;
      if (frame.runId) setActiveRun(frame.runId);
      if (frame.type === "token" && frame.runId && frame.delta) {
        setItems((old) => {
          const idx = old.findIndex((x) => x.role === "assistant" && x.runId === frame.runId);
          if (idx < 0)
            return [
              ...old,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: frame.delta ?? "",
                runId: frame.runId,
                agentId: frame.agentId,
              },
            ];
          const next = old.slice();
          const current = next[idx];
          if (!current) return old;
          next[idx] = { ...current, content: current.content + frame.delta };
          return next;
        });
      } else if (frame.type === "message") {
        setItems((old) => [
          ...old,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: frame.content ?? "",
            runId: frame.runId,
            agentId: frame.agentId,
          },
        ]);
      } else if (frame.type === "toolStart") {
        setItems((old) => [
          ...old,
          {
            id: crypto.randomUUID(),
            role: "tool",
            toolName: frame.toolName,
            content: JSON.stringify(frame.params ?? {}, null, 2),
            runId: frame.runId,
            agentId: frame.agentId,
          },
        ]);
      } else if (frame.type === "toolEnd") {
        setItems((old) => [
          ...old,
          {
            id: crypto.randomUUID(),
            role: "tool",
            toolName: `${frame.toolName ?? "Tool"} result`,
            content: JSON.stringify(frame.result ?? {}, null, 2),
            runId: frame.runId,
            agentId: frame.agentId,
          },
        ]);
      } else if (frame.type === "needsApproval") {
        setItems((old) => [
          ...old,
          {
            id: crypto.randomUUID(),
            role: "tool",
            toolName: "Approval required",
            content: frame.actionDescription ?? "This action needs your approval.",
            runId: frame.runId,
            agentId: frame.agentId,
            approval: {
              actionId: frame.actionId ?? "",
              permissionLevel: frame.permissionLevel ?? 0,
            },
          },
        ]);
      } else if (frame.type === "secureHandoff" && frame.agentId && frame.runId) {
        setHandoff({
          agentId: frame.agentId,
          runId: frame.runId,
          reason: frame.reason || "Take control of the agent screen",
        });
        setScreenMode("handoff");
      } else if (frame.type === "settled") {
        setActiveRun("");
      } else if (frame.type === "error") {
        setError(`${frame.code ?? "error"}: ${frame.message ?? "request failed"}`);
        setActiveRun("");
      }
    });
    const stopStatus = window.agentOS.onStatus(setStatus);
    let active = true;
    void window.agentOS.restoreSession().then(async (saved) => {
      try {
        if (!active || !saved?.baseUrl || !saved.token) return;
        setBaseUrl(saved.baseUrl);
        setToken(saved.token);
        setAuthMode("token");
        await window.agentOS.connect(saved.baseUrl, saved.token);
        if (!active) return;
        const roster = (await window.agentOS.apiRequest({
          baseUrl: saved.baseUrl,
          token: saved.token,
          path: "/v1/bots",
        })) as Bot[];
        if (!active) return;
        setBots(roster);
        setBotId(roster[0]?.id ?? "");
        setSignedIn(true);
      } catch (err) {
        if (active) setAuthError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setSessionReady(true);
      }
    });
    return () => {
      active = false;
      stopFrame();
      stopStatus();
      void window.agentOS.disconnect();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the item list is the scroll trigger; the ref is stable.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [items]);

  useEffect(() => window.agentOS.onUpdateReady(() => setUpdateReady(true)), []);

  useEffect(() => {
    if (window.agentOS.platform)
      document.documentElement.dataset.platform = window.agentOS.platform;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (botDraftOpen) botNameRef.current?.focus();
  }, [botDraftOpen]);

  useEffect(() => {
    if (sessionReady && !signedIn && authMode === "create") accountNameRef.current?.focus();
  }, [sessionReady, signedIn, authMode]);

  useEffect(() => {
    const node = composerRef.current;
    if (node && !draft) node.style.height = "";
  }, [draft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") {
        setConnectOpen(false);
        setBotDraftOpen(false);
        setScreenMode((mode) => (mode === "view" ? null : mode));
        return;
      }
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "n" && !typing) {
        event.preventDefault();
        setBotDraftName("");
        setBotDraftOpen(true);
      } else if (key === "k") {
        event.preventDefault();
        showWorkspace("chat");
        window.setTimeout(() => composerRef.current?.focus(), 0);
      } else if (key === ",") {
        event.preventDefault();
        setConnectOpen(true);
      } else if (key === "f" && !typing) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".sidebar-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(
    () =>
      window.agentOS.onLocalExec((unknownFrame) => {
        const frame = unknownFrame as {
          agentId?: string;
          runId?: string;
          actionId?: string;
          command?: string;
          cwd?: string;
        };
        if (!frame.runId || !frame.actionId || !frame.command) return;
        setAllowLocalSession(false);
        setPendingLocal({
          agentId: frame.agentId ?? "",
          runId: frame.runId,
          actionId: frame.actionId,
          command: frame.command,
          cwd: frame.cwd,
        });
      }),
    [],
  );

  useEffect(() => {
    if (!botId) return;
    const stored = localStorage.getItem(`localMachineAccess:${botId}`);
    const fromBot = bots.find((bot) => bot.id === botId)?.localMachineAccess;
    const policy = isLocalPolicy(stored)
      ? stored
      : fromBot && isLocalPolicy(fromBot)
        ? fromBot
        : "always_confirm";
    void window.agentOS.setLocalPolicy(botId, policy);
  }, [botId, bots]);

  useEffect(() => {
    if (!screenMode || !screenBotId) return;
    const canvas = screenRef.current;
    if (!canvas) return;
    let closed = false;
    const session = new RawVncSession(
      canvas,
      (bytes) => {
        void window.agentOS.sendVnc(bytes);
      },
      (message) => {
        if (!closed) setError(message);
      },
    );
    const stopData = window.agentOS.onVncData((bytes) => {
      if (!closed) session.push(asBytes(bytes));
    });
    const stopStatus = window.agentOS.onVncStatus((next) => {
      if (!closed && next) setError(next);
    });
    void window.agentOS.openVnc(screenBotId).catch((err) => {
      if (!closed) setError(err instanceof Error ? err.message : String(err));
    });
    const point = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      session.pointer(
        ((event.clientX - rect.left) / rect.width) * canvas.width,
        ((event.clientY - rect.top) / rect.height) * canvas.height,
        event.buttons,
      );
    };
    const downKey = (event: KeyboardEvent) => {
      const symbol = keysym(event.key);
      if (symbol === null) return;
      event.preventDefault();
      session.key(symbol, true);
    };
    const upKey = (event: KeyboardEvent) => {
      const symbol = keysym(event.key);
      if (symbol === null) return;
      session.key(symbol, false);
    };
    if (screenMode === "handoff") {
      canvas.addEventListener("pointerdown", point);
      canvas.addEventListener("pointermove", point);
      canvas.addEventListener("pointerup", point);
      window.addEventListener("keydown", downKey);
      window.addEventListener("keyup", upKey);
    }
    return () => {
      closed = true;
      stopData();
      stopStatus();
      canvas.removeEventListener("pointerdown", point);
      canvas.removeEventListener("pointermove", point);
      canvas.removeEventListener("pointerup", point);
      window.removeEventListener("keydown", downKey);
      window.removeEventListener("keyup", upKey);
      void window.agentOS.closeVnc();
    };
  }, [screenMode, screenBotId]);

  async function connect(next?: { baseUrl?: string; token?: string }): Promise<boolean> {
    const url = next?.baseUrl ?? baseUrl;
    const bearer = next?.token ?? token;
    setError("");
    setAuthError("");
    try {
      await window.agentOS.connect(url, bearer);
      const roster = (await window.agentOS.apiRequest({
        baseUrl: url,
        token: bearer,
        path: "/v1/bots",
      })) as Bot[];
      setBaseUrl(url);
      setToken(bearer);
      setBots(roster);
      setBotId(roster[0]?.id ?? "");
      setConnectOpen(false);
      setSignedIn(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAuthError(message);
      setError(message);
      return false;
    }
  }

  async function createAccount() {
    const name = accountName.trim();
    const email = accountEmail.trim().toLowerCase();
    if (!name) {
      setAuthError("Enter your name.");
      return;
    }
    if (!isAccountEmail(email)) {
      setAuthError("Enter a valid email address.");
      return;
    }
    let gateway: URL;
    try {
      gateway = new URL(baseUrl.trim());
    } catch {
      setAuthError("Enter a gateway address such as http://127.0.0.1:8787.");
      return;
    }
    if (gateway.protocol !== "http:" && gateway.protocol !== "https:") {
      setAuthError("The gateway address must start with http:// or https://.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const created = (await window.agentOS.apiRequest({
        baseUrl: gateway.origin,
        token: "",
        path: "/v1/auth/bootstrap",
        method: "POST",
        body: { email, displayName: name },
      })) as { token?: string };
      if (!created.token) throw new Error("The gateway did not return a session.");
      setBaseUrl(gateway.origin);
      setToken(created.token);
      const signedInNow = await connect({ baseUrl: gateway.origin, token: created.token });
      if (!signedInNow) setAuthMode("token");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("bootstrap is closed")) {
        setAuthMode("token");
        setAuthError("This gateway already has an account. Sign in with its saved token.");
      } else {
        setAuthError(message);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function createBot(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/bots",
        method: "POST",
        body: { name: trimmed },
      });
      const roster = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/bots",
      })) as Bot[];
      setBots(roster);
      setBotId(roster[roster.length - 1]?.id ?? "");
      setBotDraftOpen(false);
      setBotDraftName("");
      showWorkspace("chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadMemories() {
    if (!botId) return;
    try {
      const rows = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}/memory`,
      })) as MemoryEntry[];
      setMemoryEntries(rows);
      showWorkspace("memory");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadInferenceSettings() {
    if (!botId) return;
    try {
      const [bot, providerResponse] = (await Promise.all([
        window.agentOS.apiRequest({ baseUrl, token, path: `/v1/bots/${botId}` }),
        window.agentOS.apiRequest({ baseUrl, token, path: "/v1/inference/providers" }),
      ])) as [Bot, { providers: Array<{ id: string }> }];
      const providers = providerResponse.providers.map((provider) => provider.id);
      setInferenceProviders(providers);
      setInferenceProviderId(bot.inferenceSettings?.providerId ?? "");
      setInferenceModel(bot.inferenceSettings?.model ?? "");
      setRetainData(bot.retainData !== false);
      showWorkspace("model");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveInferenceSettings() {
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}`,
        method: "PATCH",
        body: {
          inferenceSettings: { providerId: inferenceProviderId, model: inferenceModel.trim() },
        },
      });
      setNotice("Model settings saved. They apply to new runs.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadAutomations() {
    try {
      const [skills, routines] = await Promise.all([
        window.agentOS.apiRequest({ baseUrl, token, path: "/v1/skills" }) as Promise<SkillItem[]>,
        window.agentOS.apiRequest({ baseUrl, token, path: "/v1/routines" }) as Promise<
          RoutineItem[]
        >,
      ]);
      setSkillItems(skills);
      setRoutineItems(routines);
      showWorkspace("automation");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createSkill() {
    const name = window.prompt("Name for this skill");
    if (!name?.trim()) return;
    const instructions = window.prompt(
      "What should the skill do? Enter one instruction per line to create multiple steps.",
    );
    const steps = instructions
      ?.split("\n")
      .map((instruction) => instruction.trim())
      .filter(Boolean);
    if (!steps?.length) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/skills",
        method: "POST",
        body: {
          name: name.trim(),
          description: steps[0] ?? "",
          steps: steps.map((instruction) => ({ instruction })),
        },
      });
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function editSkill(skill: SkillItem) {
    setEditingSkillId(skill.id);
    setSkillDraftName(skill.name);
    setSkillDraftDescription(skill.description);
    setSkillDraftSteps(
      skill.steps.map((step) => ({
        instruction: step.instruction,
        approvalRequired: step.approvalRequired ?? false,
        onError: step.onError ?? "stop",
        maxAttempts: step.maxAttempts ?? 3,
        customPrompt: step.customPrompt ?? "",
      })),
    );
  }

  async function saveSkill() {
    const skill = skillItems.find((item) => item.id === editingSkillId);
    const steps = skillDraftSteps.map((step) => ({
      ...step,
      instruction: step.instruction.trim(),
      customPrompt: step.customPrompt.trim(),
    }));
    if (
      !skill ||
      !skillDraftName.trim() ||
      !steps.length ||
      steps.some((step) => !step.instruction) ||
      steps.some(
        (step) =>
          (step.onError === "retry" || step.onError === "custom_prompt") &&
          (!Number.isInteger(step.maxAttempts) || step.maxAttempts < 1 || step.maxAttempts > 10),
      ) ||
      steps.some((step) => step.onError === "custom_prompt" && !step.customPrompt)
    ) {
      setError(
        "Check that each step has an instruction, retry limits are 1–10, and custom recovery prompts are filled in.",
      );
      return;
    }
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/skills/${encodeURIComponent(skill.id)}`,
        method: "PATCH",
        body: {
          name: skillDraftName.trim(),
          description: skillDraftDescription.trim(),
          steps,
        },
      });
      setEditingSkillId("");
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteSkill(skill: SkillItem) {
    if (!window.confirm(`Delete skill “${skill.name}”?`)) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/skills/${encodeURIComponent(skill.id)}`,
        method: "DELETE",
      });
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function assignSkill(skill: SkillItem, targetBotId: string) {
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/skills/${encodeURIComponent(skill.id)}/assign`,
        method: "POST",
        body: { botId: targetBotId },
      });
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createRoutine(
    triggerType: "cron" | "webhook" | "inter_bot_message" | "file_change" = "cron",
  ) {
    const skill = skillItems.find((item) => !item.ownerBotId || item.ownerBotId === botId);
    if (!skill) {
      setError("Create or copy a skill to the selected bot before scheduling a routine.");
      return;
    }
    const name = window.prompt("Name for this routine", skill.name);
    if (!name?.trim()) return;
    const schedule =
      triggerType === "cron"
        ? window.prompt("Five-field cron schedule (minute hour day month weekday)", "0 9 * * *")
        : undefined;
    if (triggerType === "cron" && !schedule?.trim()) return;
    let filePath: string | undefined;
    if (triggerType === "file_change") {
      const entered = window.prompt(
        "Workspace path to watch. It must stay inside /home/agent.",
        "/home/agent",
      );
      if (!entered?.trim()) return;
      filePath = entered.trim();
    }
    let senderBotId: string | undefined;
    if (triggerType === "inter_bot_message") {
      const senders = bots.filter((bot) => bot.id !== botId && bot.role !== "subagent");
      const selection = window.prompt(
        `Optional sender bot ID (leave blank for any bot):\n${senders.map((bot) => `${bot.name}: ${bot.id}`).join("\n")}`,
        "",
      );
      if (selection === null) return;
      senderBotId = selection.trim() || undefined;
      if (senderBotId && !senders.some((bot) => bot.id === senderBotId)) {
        setError("Choose a sender bot ID from the list, or leave it blank for any bot.");
        return;
      }
    }
    try {
      const created = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/routines",
        method: "POST",
        body: {
          botId,
          skillId: skill.id,
          name,
          trigger:
            triggerType === "cron"
              ? { type: "cron", schedule }
              : triggerType === "webhook"
                ? { type: "webhook" }
                : triggerType === "file_change"
                  ? { type: "file_change", path: filePath }
                  : { type: "inter_bot_message", ...(senderBotId ? { senderBotId } : {}) },
        },
      })) as { routine: RoutineItem; webhookSecret?: string };
      if (triggerType === "webhook" && created.webhookSecret)
        setRoutineWebhookSetup({
          url: `${baseUrl.replace(/\/$/, "")}/v1/webhooks/${created.routine.id}`,
          secret: created.webhookSecret,
        });
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function editRoutine(routine: RoutineItem) {
    setEditingRoutineId(routine.id);
    setRoutineDraftName(routine.name);
    setRoutineDraftBotId(routine.botId);
    setRoutineDraftSkillId(routine.skillId);
    setRoutineDraftSchedule(
      routine.trigger.type === "cron" ? (routine.trigger.schedule ?? "") : "",
    );
    setRoutineDraftSenderBotId(
      routine.trigger.type === "inter_bot_message" ? (routine.trigger.senderBotId ?? "") : "",
    );
    setRoutineDraftPath(routine.trigger.type === "file_change" ? (routine.trigger.path ?? "") : "");
    setRoutineDraftOnError(routine.onError ?? "pause");
  }

  async function saveRoutineEdit(routine: RoutineItem) {
    const assignmentChanged =
      routineDraftBotId !== routine.botId || routineDraftSkillId !== routine.skillId;
    if (
      assignmentChanged &&
      !window.confirm(
        `Reassign “${routine.name}” to the selected bot and skill? Future runs will use that assignment.`,
      )
    )
      return;
    if (!routineDraftName.trim() || !routineDraftBotId || !routineDraftSkillId) {
      setError("Routine name, bot, and skill are required.");
      return;
    }
    if (routine.trigger.type === "cron" && !routineDraftSchedule.trim()) {
      setError("A cron routine needs a five-field schedule.");
      return;
    }
    if (routine.trigger.type === "file_change" && !routineDraftPath.trim()) {
      setError("A file-change routine needs a path inside /home/agent.");
      return;
    }
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/routines/${routine.id}`,
        method: "PATCH",
        body: {
          name: routineDraftName.trim(),
          ...(routineDraftBotId !== routine.botId ? { botId: routineDraftBotId } : {}),
          ...(routineDraftSkillId !== routine.skillId ? { skillId: routineDraftSkillId } : {}),
          ...(routine.trigger.type === "cron"
            ? { trigger: { type: "cron", schedule: routineDraftSchedule.trim() } }
            : routine.trigger.type === "inter_bot_message"
              ? {
                  trigger: {
                    type: "inter_bot_message",
                    ...(routineDraftSenderBotId ? { senderBotId: routineDraftSenderBotId } : {}),
                  },
                }
              : routine.trigger.type === "file_change"
                ? { trigger: { type: "file_change", path: routineDraftPath.trim() } }
                : {}),
          onError: routineDraftOnError,
        },
      });
      setEditingRoutineId("");
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function updateRoutine(
    routine: RoutineItem,
    update: { enabled?: boolean; delete?: boolean; test?: boolean },
  ) {
    try {
      if (update.test) {
        if (
          !window.confirm(
            `Run “${routine.name}” now? This executes its skill immediately and may perform configured external actions.`,
          )
        )
          return;
        await window.agentOS.apiRequest({
          baseUrl,
          token,
          path: `/v1/routines/${routine.id}/test`,
          method: "POST",
        });
      } else if (update.delete) {
        if (!window.confirm(`Delete routine “${routine.name}”?`)) return;
        await window.agentOS.apiRequest({
          baseUrl,
          token,
          path: `/v1/routines/${routine.id}`,
          method: "DELETE",
        });
      } else {
        await window.agentOS.apiRequest({
          baseUrl,
          token,
          path: `/v1/routines/${routine.id}`,
          method: "PATCH",
          body: { enabled: update.enabled },
        });
      }
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadRoutineHistory(routine: RoutineItem) {
    try {
      const history = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/routines/${routine.id}/history`,
      })) as RoutineRunItem[];
      setRoutineHistory((previous) => ({ ...previous, [routine.id]: history }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadConnectors() {
    try {
      const [rows, mcpRows] = (await Promise.all([
        window.agentOS.apiRequest({ baseUrl, token, path: "/v1/connectors" }),
        window.agentOS.apiRequest({ baseUrl, token, path: "/v1/connectors/mcp" }),
      ])) as [ConnectorItem[], McpServerItem[]];
      setConnectorItems(rows);
      setMcpItems(mcpRows);
      showWorkspace("connectors");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadWebhooks() {
    try {
      const [subscriptions, deliveries] = (await Promise.all([
        window.agentOS.apiRequest({ baseUrl, token, path: "/v1/webhook-subscriptions" }),
        window.agentOS.apiRequest({ baseUrl, token, path: "/v1/webhook-deliveries?limit=100" }),
      ])) as [WebhookSubscriptionItem[], WebhookDeliveryItem[]];
      setWebhookSubscriptions(subscriptions);
      setWebhookDeliveries(deliveries);
      showWorkspace("webhooks");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createWebhook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/webhook-subscriptions",
        method: "POST",
        body: { url: webhookUrl.trim(), events: webhookEvents },
      })) as WebhookSubscriptionItem & { secret: string };
      setNewWebhookSecret(created.secret);
      setWebhookUrl("");
      await loadWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeWebhook(subscription: WebhookSubscriptionItem) {
    if (!window.confirm(`Delete webhook subscription for ${subscription.url}?`)) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/webhook-subscriptions/${encodeURIComponent(subscription.id)}`,
        method: "DELETE",
      });
      await loadWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function retryWebhookDelivery(delivery: WebhookDeliveryItem) {
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/webhook-deliveries/${encodeURIComponent(delivery.id)}/retry`,
        method: "POST",
      });
      await loadWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addMcpServer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/connectors/mcp",
        method: "POST",
        body: {
          name: mcpName.trim(),
          url: mcpUrl.trim(),
          ...(mcpApiKey ? { apiKey: mcpApiKey } : {}),
        },
      });
      setMcpName("");
      setMcpUrl("");
      setMcpApiKey("");
      await loadConnectors();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeMcpServer(server: McpServerItem) {
    if (!window.confirm(`Remove MCP server “${server.name}”?`)) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/connectors/mcp/${server.id}`,
        method: "DELETE",
      });
      await loadConnectors();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function connectService(
    service: "gmail" | "google-calendar" | "google-drive" | "microsoft" | "salesforce",
  ) {
    try {
      await window.agentOS.connectService(baseUrl, token, service);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const rows = (await window.agentOS.apiRequest({
          baseUrl,
          token,
          path: "/v1/connectors",
        })) as ConnectorItem[];
        setConnectorItems(rows);
        const connected =
          service === "microsoft"
            ? rows.some((row) => row.service === "microsoft")
            : rows.some((row) => row.service === service);
        if (connected) return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveRetainData(next: boolean) {
    if (!botId) return;
    setRetainData(next);
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}`,
        method: "PATCH",
        body: { retainData: next },
      });
    } catch (err) {
      setRetainData(!next);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleRecording() {
    if (!botId) {
      setError("Select a bot before recording a browser task.");
      return;
    }
    try {
      if (!recording) {
        await window.agentOS.apiRequest({
          baseUrl,
          token,
          path: `/v1/bots/${encodeURIComponent(botId)}/browser-recording/start`,
          method: "POST",
        });
        setRecording(true);
        return;
      }
      const stopped = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${encodeURIComponent(botId)}/browser-recording/stop`,
        method: "POST",
      })) as { events: unknown[] };
      setRecording(false);
      const draft = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/skills/draft",
        method: "POST",
        body: { events: stopped.events },
      })) as { name: string; description: string; steps: Array<{ instruction: string }> };
      setTaughtDraft({
        name: draft.name,
        description: draft.description,
        steps: draft.steps.map((step) => ({
          id: crypto.randomUUID(),
          instruction: step.instruction,
          approvalRequired: false,
          onError: "stop" as const,
          maxAttempts: 3,
          customPrompt: "",
        })),
      });
      showWorkspace("automation");
    } catch (err) {
      setRecording(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveTaughtDraft() {
    if (!taughtDraft?.name.trim() || taughtDraft.steps.some((step) => !step.instruction.trim())) {
      setError("The draft skill needs a name and an instruction on every step.");
      return;
    }
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/skills",
        method: "POST",
        body: {
          name: taughtDraft.name.trim(),
          description: taughtDraft.description.trim(),
          steps: taughtDraft.steps.map((step) => ({ instruction: step.instruction.trim() })),
        },
      });
      setTaughtDraft(null);
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function testSkill(skill: SkillItem) {
    const targetBotId = skill.ownerBotId || botId;
    if (!targetBotId) {
      setError("Select a bot before testing this skill.");
      return;
    }
    if (
      !window.confirm(
        `Test “${skill.name}” on this bot now? The run uses real tools and can change files, sites, and connected services.`,
      )
    )
      return;
    try {
      const started = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/skills/${encodeURIComponent(skill.id)}/test`,
        method: "POST",
        body: { botId: targetBotId },
      })) as { runId: string; status: string };
      setSkillTests((current) => ({
        ...current,
        [skill.id]: { runId: started.runId, status: started.status },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshSkillTest(skill: SkillItem) {
    const current = skillTests[skill.id];
    if (!current) return;
    try {
      const status = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/skills/${encodeURIComponent(skill.id)}/test/${encodeURIComponent(current.runId)}`,
      })) as { runId: string; status: string };
      setSkillTests((previous) => ({
        ...previous,
        [skill.id]: { runId: status.runId, status: status.status },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnectService(service: string) {
    if (!window.confirm(`Disconnect ${service}?`)) return;
    try {
      const result = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/connectors/${service}`,
        method: "DELETE",
      })) as { disconnected?: boolean; providerRevocation?: "succeeded" | "failed" | "skipped" };
      if (result.providerRevocation === "failed" || result.providerRevocation === "skipped") {
        setError(
          `${service} was disconnected locally, but provider revocation ${result.providerRevocation === "failed" ? "failed" : "was unavailable"}. Revoke the app's access in your provider account settings.`,
        );
      }
      await loadConnectors();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function editMemory(memory: MemoryEntry) {
    const content = window.prompt("Edit memory", memory.content);
    if (!content?.trim() || content === memory.content) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}/memory/${memory.id}`,
        method: "PATCH",
        body: { content },
      });
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadMemoryEvidence(memory: MemoryEntry) {
    if (memoryEvidence[memory.id]) {
      setMemoryEvidence((entries) => {
        const next = { ...entries };
        delete next[memory.id];
        return next;
      });
      return;
    }
    try {
      const entries = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${encodeURIComponent(botId)}/memory/${encodeURIComponent(memory.id)}/evidence`,
      })) as MemoryEvidenceEntry[];
      setMemoryEvidence((old) => ({ ...old, [memory.id]: entries }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteMemory(memory: MemoryEntry) {
    if (!window.confirm("Delete this memory?")) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}/memory/${memory.id}`,
        method: "DELETE",
      });
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportMemories() {
    try {
      const exportData = await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}/memory/export`,
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }),
      );
      link.download = `agentos-memory-${botId}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addDroppedFiles(files: FileList | File[]) {
    if (!botId || !token) return;
    const next = [...pendingFiles];
    let total = next.reduce((sum, file) => sum + file.sizeBytes, 0);
    for (const file of Array.from(files)) {
      if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) {
        setError(`${file.name} exceeds 10 MB`);
        continue;
      }
      if (total + file.size > MAX_PROMPT_ATTACHMENT_BYTES) {
        setError("attachments exceed 25 MB");
        break;
      }
      const stored = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}/attachments`,
        method: "POST",
        body: {
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64: await fileToBase64(file),
        },
      })) as PendingAttachment;
      next.push(stored);
      total += stored.sizeBytes;
    }
    setPendingFiles(next);
  }

  async function sendPrompt(event: React.FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    const attachments = pendingFiles;
    if ((!prompt && attachments.length === 0) || !botId) return;
    const names = attachments.map((file) => file.name).join("\n");
    setItems((old) => [
      ...old,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: [prompt, names].filter(Boolean).join("\n"),
        agentId: botId,
      },
    ]);
    setDraft("");
    setPendingFiles([]);
    setError("");
    try {
      await window.agentOS.send({
        type: "sendPrompt",
        agentId: botId,
        prompt,
        attachments,
        nonce: crypto.randomUUID(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openLocalSettings() {
    if (!botId) return;
    try {
      const bot = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}`,
      })) as Bot;
      const policy = isLocalPolicy(bot.localMachineAccess)
        ? bot.localMachineAccess
        : "always_confirm";
      setLocalAccess(policy);
      localStorage.setItem(`localMachineAccess:${botId}`, policy);
      await window.agentOS.setLocalPolicy(botId, policy);
      showWorkspace("local");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveLocalAccess(policy: LocalPolicy) {
    if (!botId) return;
    setLocalAccess(policy);
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}`,
        method: "PATCH",
        body: { tools: { localMachineAccess: policy } },
      });
      localStorage.setItem(`localMachineAccess:${botId}`, policy);
      await window.agentOS.setLocalPolicy(botId, policy);
      setBots((current) =>
        current.map((bot) => (bot.id === botId ? { ...bot, localMachineAccess: policy } : bot)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function replyLocal(decision: "allow" | "deny" | "allow_session") {
    const frame = pendingLocal;
    if (!frame) return;
    setPendingLocal(null);
    try {
      await window.agentOS.replyLocalExec(decision, frame);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function returnControl() {
    if (!handoff) return;
    try {
      await window.agentOS.send({
        type: "returnToBot",
        agentId: handoff.agentId,
        runId: handoff.runId,
      });
      setScreenMode(null);
      setHandoff(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function decide(item: ChatItem, decision: "allow_once" | "deny" | "always_allow") {
    if (!item.runId || !item.approval) return;
    try {
      await window.agentOS.send({
        type: "approve",
        agentId: item.agentId ?? botId,
        runId: item.runId,
        actionId: item.approval.actionId,
        decision,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setItems((old) =>
      old.map((x) =>
        x.id === item.id
          ? { ...x, approval: undefined, content: `${x.content}\nDecision: ${decision}` }
          : x,
      ),
    );
  }

  function showWorkspace(
    next: "chat" | "memory" | "automation" | "connectors" | "webhooks" | "local" | "model",
  ) {
    setMemoryOpen(next === "memory");
    setAutomationOpen(next === "automation");
    setConnectorOpen(next === "connectors");
    setWebhookOpen(next === "webhooks");
    setLocalOpen(next === "local");
    setModelOpen(next === "model");
    setConnectOpen(false);
    if (next !== "chat") setScreenMode((mode) => (mode === "handoff" ? mode : null));
  }

  const selectedBot = bots.find((bot) => bot.id === botId);
  const visibleBots = bots.filter((bot) =>
    bot.name.toLowerCase().includes(botQuery.trim().toLowerCase()),
  );
  const workspace = webhookOpen
    ? "webhooks"
    : connectorOpen
      ? "connectors"
      : automationOpen
        ? "automation"
        : memoryOpen
          ? "memory"
          : localOpen
            ? "local"
            : modelOpen
              ? "model"
              : "chat";
  const workspaceTitle =
    workspace === "memory"
      ? "Memory"
      : workspace === "automation"
        ? "Skills & routines"
        : workspace === "connectors"
          ? "Connectors"
          : workspace === "webhooks"
            ? "Webhooks"
            : workspace === "local"
              ? "This computer"
              : workspace === "model"
                ? "Model & privacy"
                : (selectedBot?.name ?? "Choose a bot");
  const workspaceSubtitle =
    workspace === "chat"
      ? activeRun
        ? "Working"
        : (selectedBot?.role ?? "Agent conversation")
      : (selectedBot?.name ?? "Workspace");

  return (
    <div className="app-shell">
      {!signedIn && (
        <section className="auth-gate" aria-label="Account">
          <form
            className="auth-card"
            onSubmit={(event) => {
              event.preventDefault();
              if (!sessionReady || authBusy) return;
              if (authMode === "create") void createAccount();
              else void connect();
            }}
          >
            <div className="auth-mark">A</div>
            <h1>{authMode === "create" ? "Create your account" : "Sign in"}</h1>
            <p>
              {sessionReady
                ? authMode === "create"
                  ? "This creates the first account on the gateway and keeps you signed in on this computer."
                  : "Use the token from the account that already exists on this gateway."
                : "Opening your saved session…"}
            </p>
            {sessionReady && authMode === "create" && (
              <>
                <label>
                  Name
                  <input
                    ref={accountNameRef}
                    value={accountName}
                    onChange={(event) => setAccountName(event.target.value)}
                    placeholder="Your name"
                    maxLength={80}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Email
                  <input
                    value={accountEmail}
                    onChange={(event) => setAccountEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                  />
                </label>
              </>
            )}
            {sessionReady && authMode === "token" && (
              <label>
                Account token
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  placeholder="Paste token"
                  autoComplete="current-password"
                  spellCheck={false}
                />
              </label>
            )}
            {sessionReady && (
              <label>
                Gateway
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  spellCheck={false}
                  autoComplete="url"
                />
              </label>
            )}
            {authError && (
              <p className="auth-error" role="alert">
                {authError}
              </p>
            )}
            {sessionReady && (
              <button type="submit" className="primary" disabled={authBusy}>
                {authBusy
                  ? "Creating account…"
                  : authMode === "create"
                    ? "Create account"
                    : "Sign in"}
              </button>
            )}
            {sessionReady &&
              (authMode === "create" ? (
                <button
                  type="button"
                  className="auth-switch"
                  onClick={() => {
                    setAuthMode("token");
                    setAuthError("");
                  }}
                >
                  I already have a token
                </button>
              ) : (
                <button
                  type="button"
                  className="auth-switch"
                  onClick={() => {
                    setAuthMode("create");
                    setAuthError("");
                  }}
                >
                  Create a new account
                </button>
              ))}
          </form>
        </section>
      )}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>AgentOS</span>
        </div>
        <nav className="sidebar-nav" aria-label="Workspace">
          <button
            type="button"
            className={`nav-item ${workspace === "chat" ? "active" : ""}`}
            aria-current={workspace === "chat" ? "page" : undefined}
            onClick={() => showWorkspace("chat")}
          >
            <Glyph>
              <path d="M2.5 3.5h11v7.2H6.2L3.2 13V10.7H2.5z" />
            </Glyph>
            Chat
          </button>
          <button
            type="button"
            className={`nav-item ${workspace === "memory" ? "active" : ""}`}
            aria-current={workspace === "memory" ? "page" : undefined}
            disabled={!botId}
            onClick={() => void loadMemories()}
          >
            <Glyph>
              <path d="M4 2.5h8v11l-4-2.2-4 2.2z" />
            </Glyph>
            Memory
          </button>
          <button
            type="button"
            className={`nav-item ${workspace === "automation" ? "active" : ""}`}
            aria-current={workspace === "automation" ? "page" : undefined}
            disabled={!token}
            onClick={() => void loadAutomations()}
          >
            <Glyph>
              <path d="M3 4.5h10M3 8h10M3 11.5h6" />
            </Glyph>
            Skills
          </button>
          <button
            type="button"
            className={`nav-item ${workspace === "connectors" ? "active" : ""}`}
            aria-current={workspace === "connectors" ? "page" : undefined}
            disabled={!token}
            onClick={() => void loadConnectors()}
          >
            <Glyph>
              <path d="M6.2 9.2 4.4 11a2.2 2.2 0 0 1-3.1-3.1l1.8-1.8M9.8 6.8 11.6 5a2.2 2.2 0 0 1 3.1 3.1l-1.8 1.8M6.2 9.8l3.6-3.6" />
            </Glyph>
            Connectors
          </button>
          <button
            type="button"
            className={`nav-item ${workspace === "webhooks" ? "active" : ""}`}
            aria-current={workspace === "webhooks" ? "page" : undefined}
            disabled={!token}
            onClick={() => void loadWebhooks()}
          >
            <Glyph>
              <path d="M8.8 1.8 4.2 8.2h3.2L6.6 14l5.2-7.2H8.6z" />
            </Glyph>
            Webhooks
          </button>
          <button
            type="button"
            className={`nav-item ${workspace === "model" ? "active" : ""}`}
            aria-current={workspace === "model" ? "page" : undefined}
            disabled={!botId}
            onClick={() => void loadInferenceSettings()}
          >
            <Glyph>
              <path d="M8 2.2v2.1M8 11.7v2.1M2.2 8h2.1M11.7 8h2.1M4 4l1.5 1.5M10.5 10.5 12 12M12 4l-1.5 1.5M5.5 10.5 4 12" />
              <circle cx="8" cy="8" r="2.2" />
            </Glyph>
            Model
          </button>
          <button
            type="button"
            className={`nav-item ${workspace === "local" ? "active" : ""}`}
            aria-current={workspace === "local" ? "page" : undefined}
            disabled={!botId}
            onClick={() => void openLocalSettings()}
          >
            <Glyph>
              <rect x="2.2" y="3" width="11.6" height="7.6" rx="1.2" />
              <path d="M6 13.2h4M8 10.6v2.6" />
            </Glyph>
            This computer
          </button>
        </nav>
        <div className="roster-head">
          <span>Bots</span>
          <button
            type="button"
            className="icon-button"
            title="New bot (Ctrl+N)"
            onClick={() => {
              setBotDraftName("");
              setBotDraftOpen(true);
            }}
            disabled={!token}
          >
            +
          </button>
        </div>
        <input
          className="sidebar-search"
          value={botQuery}
          onChange={(event) => setBotQuery(event.target.value)}
          placeholder="Search bots"
          aria-label="Search bots"
        />
        <div className="roster">
          {visibleBots.map((bot) => (
            <button
              type="button"
              key={bot.id}
              className={`bot-row ${bot.id === botId ? "selected" : ""}`}
              onClick={() => {
                setBotId(bot.id);
                setItems([]);
                showWorkspace("chat");
              }}
            >
              <span className="bot-avatar">{bot.name.slice(0, 1).toUpperCase()}</span>
              <span className="bot-name">
                {bot.name}
                <small>{bot.role}</small>
              </span>
            </button>
          ))}
          {!bots.length && <p className="empty-note">Connect to load your bots.</p>}
          {!!bots.length && !visibleBots.length && (
            <p className="empty-note">No bots match that search.</p>
          )}
        </div>
        <div className="sidebar-footer">
          {connectOpen && (
            <form
              className="connect-popover"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <label>
                Gateway URL
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label>
                Bearer token
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  placeholder="Account token"
                  autoComplete="current-password"
                />
              </label>
              <div className="popover-actions">
                <button type="submit" className="primary">
                  Connect
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void window.agentOS.disconnect();
                    setSignedIn(false);
                    setAuthMode(token ? "token" : "create");
                    setAuthError("");
                  }}
                  disabled={status !== "connected"}
                >
                  Disconnect
                </button>
              </div>
            </form>
          )}
          <button
            type="button"
            className="account-row"
            onClick={() => setConnectOpen((open) => !open)}
            aria-expanded={connectOpen}
          >
            <i className={status === "connected" ? "online" : ""} />
            <span>
              <strong>{status === "connected" ? "Connected" : "Not connected"}</strong>
              <small>{gatewayHost(baseUrl)}</small>
            </span>
          </button>
        </div>
      </aside>
      <main className="chat-panel">
        <UpdateBanner ready={updateReady} onRestart={() => void window.agentOS.restartToUpdate()} />
        <header className="chat-header">
          <div className="title-block">
            <strong>{workspaceTitle}</strong>
            <span>
              {activeRun && workspace === "chat" && <i className="working-dot" />}
              {workspaceSubtitle}
            </span>
          </div>
          <div className="header-actions">
            {activeRun && (
              <button
                type="button"
                className="stop-button"
                onClick={() =>
                  void window.agentOS.send({ type: "interrupt", agentId: botId, runId: activeRun })
                }
              >
                Stop
              </button>
            )}
            <button
              type="button"
              className={screenMode === "view" ? "primary" : ""}
              onClick={() => setScreenMode((mode) => (mode === "view" ? null : "view"))}
              disabled={!botId || screenMode === "handoff"}
            >
              {screenMode === "view" ? "Hide screen" : "Agent screen"}
            </button>
          </div>
        </header>
        {botDraftOpen && (
          <form
            className="sheet-backdrop"
            onSubmit={(event) => {
              event.preventDefault();
              void createBot(botDraftName);
            }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setBotDraftOpen(false);
            }}
          >
            <div className="sheet">
              <h2>New bot</h2>
              <p>Give this agent a name. You can change its model after it is created.</p>
              <input
                ref={botNameRef}
                value={botDraftName}
                onChange={(event) => setBotDraftName(event.target.value)}
                placeholder="Name"
                maxLength={80}
                aria-label="Bot name"
              />
              <div className="popover-actions">
                <button type="button" onClick={() => setBotDraftOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={!botDraftName.trim() || !token}>
                  Create
                </button>
              </div>
            </div>
          </form>
        )}
        {workspace === "local" && (
          <section className="messages memory-view">
            <h2>Local computer execution</h2>
            {(
              [
                ["always_confirm", "Always require approval"],
                ["always_allow", "Always allow"],
                ["never", "Never allow"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="skill-approval-toggle choice-card">
                <input
                  type="radio"
                  name="local-machine-access"
                  checked={localAccess === value}
                  onChange={() => void saveLocalAccess(value)}
                />
                {label}
              </label>
            ))}
            <button type="button" onClick={() => showWorkspace("chat")}>
              Back to chat
            </button>
          </section>
        )}
        {pendingLocal && (
          <div className="sheet-backdrop">
            <section className="local-exec-dialog">
              <h2>Run on this computer?</h2>
              <pre>{pendingLocal.command}</pre>
              <p>{pendingLocal.cwd || "The desktop's default directory"}</p>
              <label className="skill-approval-toggle">
                <input
                  type="checkbox"
                  checked={allowLocalSession}
                  onChange={(event) => setAllowLocalSession(event.target.checked)}
                />
                Always allow this session
              </label>
              <div className="approval-actions">
                <button
                  type="button"
                  onClick={() => void replyLocal(allowLocalSession ? "allow_session" : "allow")}
                >
                  Run
                </button>
                <button type="button" className="deny" onClick={() => void replyLocal("deny")}>
                  Block
                </button>
              </div>
            </section>
          </div>
        )}
        {screenMode && screenBotId && (
          <section className="screen-view">
            <p>
              {screenMode === "handoff"
                ? handoff?.reason
                : "Viewing the agent screen. The turn keeps running."}
            </p>
            <canvas ref={screenRef} width={1280} height={800} />
            {screenMode === "handoff" ? (
              <button type="button" onClick={() => void returnControl()}>
                Return to Bot
              </button>
            ) : (
              <button type="button" onClick={() => setScreenMode(null)}>
                Close
              </button>
            )}
          </section>
        )}
        {workspace === "model" && (
          <section className="messages memory-view">
            <h2>Model settings · {bots.find((bot) => bot.id === botId)?.name}</h2>
            <label>
              Primary provider
              <select
                value={inferenceProviderId}
                onChange={(event) => setInferenceProviderId(event.target.value)}
              >
                <option value="">Account default</option>
                {inferenceProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model override (optional)
              <input
                value={inferenceModel}
                onChange={(event) => setInferenceModel(event.target.value)}
                placeholder="Use provider default"
                maxLength={200}
              />
            </label>
            <h2>Privacy</h2>
            <label className="skill-approval-toggle">
              <input
                type="checkbox"
                checked={retainData}
                onChange={(event) => void saveRetainData(event.target.checked)}
              />
              Allow AgentOS to retain conversation data for product improvement
            </label>
            <p>
              Disabling this does not delete existing data. Use Memory → Export and then delete
              entries to remove stored facts.
            </p>
            <div className="memory-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void saveInferenceSettings()}
              >
                Save model settings
              </button>
              <button type="button" onClick={() => showWorkspace("chat")}>
                Back to chat
              </button>
            </div>
          </section>
        )}
        {workspace === "webhooks" ? (
          <section className="messages memory-view">
            <div className="memory-toolbar">
              <h2>Outbound webhooks</h2>
              <div>
                <button type="button" onClick={() => void loadWebhooks()}>
                  Refresh
                </button>
                <button type="button" onClick={() => setWebhookOpen(false)}>
                  Back to chat
                </button>
              </div>
            </div>
            <p className="empty-note">
              Deliveries are signed with HMAC-SHA256. Terminal delivery history is retained for 30
              days by default.
            </p>
            {newWebhookSecret && (
              <output className="routine-webhook-setup">
                <strong>Save this signing secret now</strong>
                <p>AgentOS stores only an encrypted copy and will not show it again.</p>
                <code>{newWebhookSecret}</code>
                <button type="button" onClick={() => setNewWebhookSecret("")}>
                  Done
                </button>
              </output>
            )}
            <form className="mcp-server-form" onSubmit={(event) => void createWebhook(event)}>
              <input
                aria-label="Webhook HTTPS URL"
                type="url"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder="https://example.com/agentos-events"
                required
              />
              <fieldset>
                <legend>Events</legend>
                {(["turn.settled", "routine.completed", "approval.required"] as const).map(
                  (eventName) => (
                    <label key={eventName}>
                      <input
                        type="checkbox"
                        checked={webhookEvents.includes(eventName)}
                        onChange={(event) =>
                          setWebhookEvents((current) =>
                            event.target.checked
                              ? [...current, eventName]
                              : current.filter((item) => item !== eventName),
                          )
                        }
                      />
                      {eventName}
                    </label>
                  ),
                )}
              </fieldset>
              <button type="submit" disabled={!token || webhookEvents.length === 0}>
                Create webhook
              </button>
            </form>
            <h3>Subscriptions</h3>
            {!webhookSubscriptions.length && (
              <p className="empty-note">No webhook subscriptions.</p>
            )}
            {webhookSubscriptions.map((subscription) => (
              <article className="memory-entry" key={subscription.id}>
                <div>
                  <strong>{subscription.url}</strong>
                  <small>Created {new Date(subscription.createdAt).toLocaleString()}</small>
                </div>
                <p>Events: {subscription.events.join(", ")}</p>
                <button type="button" onClick={() => void removeWebhook(subscription)}>
                  Delete subscription
                </button>
              </article>
            ))}
            <h3>Recent deliveries</h3>
            {!webhookDeliveries.length && <p className="empty-note">No deliveries recorded.</p>}
            {webhookDeliveries.map((delivery) => (
              <article className="memory-entry" key={delivery.id}>
                <div>
                  <strong>
                    {delivery.event} · {delivery.status}
                  </strong>
                  <small>
                    {new Date(delivery.createdAt).toLocaleString()} · attempt{" "}
                    {delivery.attemptCount}
                  </small>
                </div>
                <p>
                  {delivery.lastStatusCode ? `HTTP ${delivery.lastStatusCode}` : "No HTTP response"}
                  {delivery.lastError ? ` · ${delivery.lastError}` : ""}
                </p>
                {delivery.status === "failed" && (
                  <button type="button" onClick={() => void retryWebhookDelivery(delivery)}>
                    Retry delivery
                  </button>
                )}
              </article>
            ))}
          </section>
        ) : workspace === "connectors" ? (
          <section className="messages memory-view">
            <div className="memory-toolbar">
              <h2>Connectors</h2>
              <div>
                <button type="button" onClick={() => void loadConnectors()}>
                  Refresh
                </button>
                <button type="button" onClick={() => setConnectorOpen(false)}>
                  Back to chat
                </button>
              </div>
            </div>
            <div className="connector-grid">
              {CONNECTOR_CARDS.map((card) => {
                const connected = connectorItems.some(
                  (item) =>
                    item.service === card.id ||
                    (card.oauth === "microsoft" && item.service === "microsoft"),
                );
                return (
                  <article
                    className={`memory-entry connector-card ${connected ? "is-on" : ""}`}
                    key={card.id}
                  >
                    <div>
                      <strong>{card.label}</strong>
                      <small>{connected ? "Connected" : "Not connected"}</small>
                    </div>
                    {card.oauth === "microsoft" && (
                      <p>OneDrive, Outlook, Teams, and SharePoint share one Microsoft sign-in.</p>
                    )}
                    <div className="memory-actions">
                      {connected ? (
                        <button type="button" onClick={() => void disconnectService(card.oauth)}>
                          Disconnect
                        </button>
                      ) : (
                        <button type="button" onClick={() => void connectService(card.oauth)}>
                          Connect
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {connectorItems.map((connector) => (
              <article className="memory-entry" key={connector.service}>
                <div>
                  <strong>{connector.service}</strong>
                  <small>Connected {new Date(connector.connectedAt).toLocaleString()}</small>
                </div>
                <p>Scopes: {connector.scopes.join(", ") || "provider defaults"}</p>
                <div className="memory-actions">
                  <button type="button" onClick={() => void disconnectService(connector.service)}>
                    Disconnect
                  </button>
                </div>
              </article>
            ))}
            <h3>MCP servers</h3>
            <p className="empty-note">
              Connect an HTTPS MCP endpoint with a public hostname. API keys are encrypted before
              storage.
            </p>
            <form className="mcp-server-form" onSubmit={(event) => void addMcpServer(event)}>
              <input
                aria-label="MCP server name"
                value={mcpName}
                onChange={(event) => setMcpName(event.target.value)}
                placeholder="Server name"
                required
                maxLength={120}
              />
              <input
                aria-label="MCP server URL"
                type="url"
                value={mcpUrl}
                onChange={(event) => setMcpUrl(event.target.value)}
                placeholder="https://mcp.example.com"
                required
              />
              <input
                aria-label="MCP API key"
                type="password"
                autoComplete="new-password"
                value={mcpApiKey}
                onChange={(event) => setMcpApiKey(event.target.value)}
                placeholder="Bearer API key (optional)"
              />
              <button type="submit" disabled={!token}>
                Add MCP server
              </button>
            </form>
            {!mcpItems.length && <p className="empty-note">No MCP servers configured.</p>}
            {mcpItems.map((server) => (
              <article className="memory-entry" key={server.id}>
                <div>
                  <strong>{server.name}</strong>
                  <small>
                    {server.lastHealth} ·{" "}
                    {server.lastCheckedAt
                      ? `checked ${new Date(server.lastCheckedAt).toLocaleString()}`
                      : "not checked"}
                  </small>
                </div>
                <p>{server.url}</p>
                <p>{server.cachedTools?.length ?? 0} discovered tools</p>
                <div className="memory-actions">
                  <button type="button" onClick={() => void removeMcpServer(server)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : workspace === "automation" ? (
          <section className="messages memory-view">
            <div className="memory-toolbar">
              <div>
                <h2>Skills and routines</h2>
                <p className="page-subtitle">
                  Procedures this workspace can run on a schedule or an event.
                </p>
              </div>
              <div className="toolbar-actions">
                <button type="button" onClick={() => void toggleRecording()} disabled={!botId}>
                  {recording ? "Stop recording" : "Record browser task"}
                </button>
                <button type="button" className="primary" onClick={() => void createSkill()}>
                  New skill
                </button>
                <details className="menu">
                  <summary>New routine</summary>
                  <div className="menu-panel">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        void createRoutine("cron");
                      }}
                      disabled={!botId || !skillItems.length}
                    >
                      On a schedule
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        void createRoutine("webhook");
                      }}
                      disabled={!botId || !skillItems.length}
                    >
                      From a webhook
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        void createRoutine("inter_bot_message");
                      }}
                      disabled={
                        !botId ||
                        !skillItems.length ||
                        bots.filter((bot) => bot.id !== botId).length === 0
                      }
                    >
                      When another bot messages
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        void createRoutine("file_change");
                      }}
                      disabled={!botId || !skillItems.length}
                    >
                      When a file changes
                    </button>
                  </div>
                </details>
                <button type="button" onClick={() => showWorkspace("chat")}>
                  Back to chat
                </button>
              </div>
            </div>
            {routineWebhookSetup && (
              <output className="routine-webhook-setup">
                <strong>Save this webhook secret now</strong>
                <p>AgentOS stores only its hash, so it cannot be shown again.</p>
                <code>POST {routineWebhookSetup.url}</code>
                <code>X-Routine-Secret: {routineWebhookSetup.secret}</code>
                <button type="button" onClick={() => setRoutineWebhookSetup(null)}>
                  Done
                </button>
              </output>
            )}
            {taughtDraft && (
              <form
                className="skill-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTaughtDraft();
                }}
              >
                <strong>Review recorded skill</strong>
                <label>
                  Name
                  <input
                    value={taughtDraft.name}
                    onChange={(event) =>
                      setTaughtDraft({ ...taughtDraft, name: event.target.value })
                    }
                    maxLength={120}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={taughtDraft.description}
                    onChange={(event) =>
                      setTaughtDraft({ ...taughtDraft, description: event.target.value })
                    }
                    rows={2}
                  />
                </label>
                {taughtDraft.steps.map((step, index) => (
                  <label key={step.id}>
                    Step {index + 1}
                    <textarea
                      value={step.instruction}
                      onChange={(event) => {
                        const steps = taughtDraft.steps.slice();
                        const current = steps[index];
                        if (!current) return;
                        steps[index] = { ...current, instruction: event.target.value };
                        setTaughtDraft({ ...taughtDraft, steps });
                      }}
                      rows={2}
                    />
                  </label>
                ))}
                <div className="memory-actions">
                  <button type="submit">Save skill</button>
                  <button type="button" onClick={() => setTaughtDraft(null)}>
                    Discard draft
                  </button>
                </div>
              </form>
            )}
            <h3>Skills</h3>
            {!skillItems.length && <p className="empty-note">No skills configured.</p>}
            {skillItems.map((skill) => (
              <article className="memory-entry" key={skill.id}>
                <strong>{skill.name}</strong>
                <p>
                  Version {skill.version ?? 1} · {skill.steps.length} steps
                  {skill.description ? ` · ${skill.description}` : ""}
                </p>
                {editingSkillId === skill.id && (
                  <div className="skill-editor">
                    <label>
                      Name
                      <input
                        value={skillDraftName}
                        onChange={(event) => setSkillDraftName(event.target.value)}
                        maxLength={120}
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        value={skillDraftDescription}
                        onChange={(event) => setSkillDraftDescription(event.target.value)}
                        rows={2}
                      />
                    </label>
                    <strong>Steps</strong>
                    {skillDraftSteps.map((step, index) => (
                      <div
                        className="skill-step-editor"
                        key={`${skill.id}-step-${index}`}
                        draggable
                        onDragStart={() => setSkillDragIndex(index)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (skillDragIndex === null || skillDragIndex === index) return;
                          setSkillDraftSteps((previous) => {
                            const next = previous.slice();
                            const [moved] = next.splice(skillDragIndex, 1);
                            if (!moved) return previous;
                            next.splice(index, 0, moved);
                            return next;
                          });
                          setSkillDragIndex(null);
                        }}
                      >
                        <label>
                          Step {index + 1}
                          <textarea
                            value={step.instruction}
                            onChange={(event) =>
                              setSkillDraftSteps((previous) =>
                                previous.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, instruction: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            rows={3}
                            required
                          />
                        </label>
                        <div>
                          <label>
                            Error handling
                            <select
                              value={step.onError}
                              onChange={(event) =>
                                setSkillDraftSteps((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          onError: event.target.value as SkillStepDraft["onError"],
                                        }
                                      : item,
                                  ),
                                )
                              }
                            >
                              <option value="stop">Stop</option>
                              <option value="retry">Retry up to 3 times</option>
                              <option value="skip">Skip step</option>
                              <option value="notify_user">Notify user</option>
                              <option value="custom_prompt">Use recovery prompt</option>
                            </select>
                          </label>
                          {step.onError === "custom_prompt" && (
                            <label>
                              Recovery prompt
                              <textarea
                                value={step.customPrompt}
                                onChange={(event) =>
                                  setSkillDraftSteps((previous) =>
                                    previous.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, customPrompt: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                                rows={3}
                                maxLength={2000}
                                required
                              />
                            </label>
                          )}
                          {(step.onError === "retry" || step.onError === "custom_prompt") && (
                            <label>
                              Maximum failed actions (1–10)
                              <input
                                type="number"
                                min={1}
                                max={10}
                                step={1}
                                value={step.maxAttempts}
                                onChange={(event) =>
                                  setSkillDraftSteps((previous) =>
                                    previous.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, maxAttempts: Number(event.target.value) }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                          )}
                          <label className="skill-approval-toggle">
                            <input
                              type="checkbox"
                              checked={step.approvalRequired}
                              onChange={(event) =>
                                setSkillDraftSteps((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, approvalRequired: event.target.checked }
                                      : item,
                                  ),
                                )
                              }
                            />
                            Require approval before this step
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSkillDraftSteps((previous) =>
                              previous.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                          disabled={skillDraftSteps.length < 2}
                        >
                          Remove step
                        </button>
                      </div>
                    ))}
                    <div className="memory-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setSkillDraftSteps((previous) => [
                            ...previous,
                            {
                              instruction: "",
                              approvalRequired: false,
                              onError: "stop",
                              maxAttempts: 3,
                              customPrompt: "",
                            },
                          ])
                        }
                      >
                        Add step
                      </button>
                      <button type="button" onClick={() => void saveSkill()}>
                        Save version
                      </button>
                      <button type="button" onClick={() => setEditingSkillId("")}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <div className="memory-actions">
                  <button
                    type="button"
                    onClick={() =>
                      editingSkillId === skill.id ? setEditingSkillId("") : editSkill(skill)
                    }
                  >
                    {editingSkillId === skill.id ? "Close editor" : "Edit"}
                  </button>
                  <button type="button" onClick={() => void testSkill(skill)}>
                    Test skill
                  </button>
                  {skillTests[skill.id] && (
                    <button type="button" onClick={() => void refreshSkillTest(skill)}>
                      Test {skillTests[skill.id]?.status}
                    </button>
                  )}
                  <button type="button" onClick={() => void deleteSkill(skill)}>
                    Delete
                  </button>
                  <select
                    aria-label={`Copy ${skill.name} to another bot`}
                    value=""
                    onChange={(event) => {
                      if (event.target.value) void assignSkill(skill, event.target.value);
                    }}
                  >
                    <option value="">Copy to bot…</option>
                    {bots
                      .filter((bot) => bot.id !== skill.ownerBotId)
                      .map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name}
                        </option>
                      ))}
                  </select>
                </div>
              </article>
            ))}
            <h3>Routines</h3>
            {!routineItems.length && <p className="empty-note">No routines configured.</p>}
            {routineItems.map((routine) => (
              <article className="memory-entry" key={routine.id}>
                <div>
                  <strong>{routine.name}</strong>
                  <small>
                    {routineTriggerLabel(routine.trigger, bots)} ·{" "}
                    {routine.enabled ? "enabled" : "paused"}
                  </small>
                </div>
                <p>
                  Bot: {bots.find((bot) => bot.id === routine.botId)?.name ?? "Unknown"} · Skill:{" "}
                  {skillItems.find((skill) => skill.id === routine.skillId)?.name ?? "Unknown"}
                </p>
                {editingRoutineId === routine.id && (
                  <div className="skill-editor">
                    <label>
                      Routine name
                      <input
                        value={routineDraftName}
                        onChange={(event) => setRoutineDraftName(event.target.value)}
                        maxLength={120}
                      />
                    </label>
                    <label>
                      Bot
                      <select
                        value={routineDraftBotId}
                        onChange={(event) => {
                          const nextBotId = event.target.value;
                          setRoutineDraftBotId(nextBotId);
                          const compatibleSkills = skillItems.filter(
                            (skill) => !skill.ownerBotId || skill.ownerBotId === nextBotId,
                          );
                          if (!compatibleSkills.some((skill) => skill.id === routineDraftSkillId))
                            setRoutineDraftSkillId(compatibleSkills[0]?.id ?? "");
                        }}
                      >
                        {bots
                          .filter((bot) => bot.role !== "subagent")
                          .map((bot) => (
                            <option key={bot.id} value={bot.id}>
                              {bot.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Skill
                      <select
                        value={routineDraftSkillId}
                        onChange={(event) => setRoutineDraftSkillId(event.target.value)}
                      >
                        {skillItems
                          .filter(
                            (skill) => !skill.ownerBotId || skill.ownerBotId === routineDraftBotId,
                          )
                          .map((skill) => (
                            <option key={skill.id} value={skill.id}>
                              {skill.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {routine.trigger.type === "cron" && (
                      <>
                        <label>
                          Five-field cron schedule
                          <input
                            value={routineDraftSchedule}
                            onChange={(event) => setRoutineDraftSchedule(event.target.value)}
                            placeholder="0 9 * * *"
                          />
                        </label>
                        <p>{cronPreview(routineDraftSchedule)}</p>
                      </>
                    )}
                    {routine.trigger.type === "file_change" && (
                      <label>
                        Workspace path
                        <input
                          value={routineDraftPath}
                          onChange={(event) => setRoutineDraftPath(event.target.value)}
                          placeholder="/home/agent"
                        />
                      </label>
                    )}
                    <label>
                      When a run fails
                      <select
                        value={routineDraftOnError}
                        onChange={(event) =>
                          setRoutineDraftOnError(
                            event.target.value as "notify_user" | "retry" | "pause",
                          )
                        }
                      >
                        <option value="pause">Pause the routine</option>
                        <option value="notify_user">Notify you</option>
                        <option value="retry">Retry</option>
                      </select>
                    </label>
                    {routine.trigger.type === "inter_bot_message" && (
                      <label>
                        Sender bot filter
                        <select
                          value={routineDraftSenderBotId}
                          onChange={(event) => setRoutineDraftSenderBotId(event.target.value)}
                        >
                          <option value="">Any bot</option>
                          {bots
                            .filter(
                              (bot) => bot.id !== routineDraftBotId && bot.role !== "subagent",
                            )
                            .map((bot) => (
                              <option key={bot.id} value={bot.id}>
                                {bot.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <div className="memory-actions">
                      <button type="button" onClick={() => void saveRoutineEdit(routine)}>
                        Save routine
                      </button>
                      <button type="button" onClick={() => setEditingRoutineId("")}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <p>
                  Last run:{" "}
                  {routine.lastTriggeredAt
                    ? new Date(routine.lastTriggeredAt).toLocaleString()
                    : "never"}
                </p>
                {routine.trigger.type === "cron" && (
                  <p>
                    Next run:{" "}
                    {routine.nextRunAt
                      ? new Date(routine.nextRunAt).toLocaleString()
                      : "not scheduled"}
                    {routine.cronTimezone ? ` (${routine.cronTimezone})` : ""}
                  </p>
                )}
                {routine.trigger.type === "webhook" && (
                  <p>Webhook: POST {`${baseUrl.replace(/\/$/, "")}/v1/webhooks/${routine.id}`}</p>
                )}
                {routineHistory[routine.id]?.slice(0, 20).map((run) => (
                  <details key={run.id}>
                    <summary>
                      {new Date(run.triggeredAt).toLocaleString()} · {run.status}
                      {run.durationMs ? ` · ${run.durationMs}ms` : ""}
                    </summary>
                    <p>{run.inputSummary}</p>
                    <p>{run.outputSummary || run.errorMessage || "No result summary"}</p>
                  </details>
                ))}
                <div className="memory-actions">
                  <button type="button" onClick={() => editRoutine(routine)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => void updateRoutine(routine, { test: true })}>
                    Test run
                  </button>
                  <button type="button" onClick={() => void loadRoutineHistory(routine)}>
                    History
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateRoutine(routine, { enabled: !routine.enabled })}
                  >
                    {routine.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateRoutine(routine, { delete: true })}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : workspace === "memory" ? (
          <section className="messages memory-view">
            <div className="memory-toolbar">
              <h2>Memory</h2>
              <div>
                <button type="button" onClick={() => void exportMemories()}>
                  Export JSON
                </button>
                <button type="button" onClick={() => showWorkspace("chat")}>
                  Back to chat
                </button>
              </div>
            </div>
            {!memoryEntries.length && <p className="empty-note">No saved memories for this bot.</p>}
            {memoryEntries.map((memory) => (
              <article className="memory-entry" key={memory.id}>
                <div>
                  <span className="memory-scope">{memory.scope}</span>
                  <small>
                    {memory.source} · updated {new Date(memory.updatedAt).toLocaleString()}
                    {memory.staleAfter
                      ? ` · stale after ${new Date(memory.staleAfter).toLocaleString()}`
                      : " · no expiry"}
                  </small>
                </div>
                <p>{memory.content}</p>
                <div className="memory-actions">
                  <button type="button" onClick={() => void loadMemoryEvidence(memory)}>
                    {memoryEvidence[memory.id] ? "Hide evidence" : "Evidence"}
                  </button>
                  <button type="button" onClick={() => void editMemory(memory)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => void deleteMemory(memory)}>
                    Delete
                  </button>
                </div>
                {memoryEvidence[memory.id]?.length ? (
                  <ul>
                    {(memoryEvidence[memory.id] ?? []).map((entry) => (
                      <li key={entry.id}>
                        Supported by turn {entry.turnId} ·{" "}
                        {new Date(entry.createdAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                ) : memoryEvidence[memory.id] ? (
                  <p className="empty-note">No automatic extraction evidence is recorded.</p>
                ) : null}
              </article>
            ))}
          </section>
        ) : workspace === "chat" ? (
          <div className="messages" ref={scrollRef}>
            {!items.length && (
              <div className="welcome">
                <div className="welcome-icon">✦</div>
                <h1>{selectedBot ? `Message ${selectedBot.name}` : "What can I help with?"}</h1>
                <p>
                  Send a task to the selected agent. Tool activity, files, and approval requests
                  stay in this conversation.
                </p>
                <div className="suggestion-row">
                  {[
                    "Summarize what you can do",
                    "Check my connected accounts",
                    "Plan the next routine",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={!botId}
                      onClick={() => {
                        setDraft(suggestion);
                        composerRef.current?.focus();
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {items.map((item) => (
              <article key={item.id} className={`message ${item.role}`}>
                {item.role === "tool" ? (
                  <details open={item.approval !== undefined}>
                    <summary>{item.toolName}</summary>
                    <pre>{item.content}</pre>
                    {item.approval && (
                      <div className="approval-actions">
                        <button type="button" onClick={() => void decide(item, "allow_once")}>
                          Allow once
                        </button>
                        <button type="button" onClick={() => void decide(item, "always_allow")}>
                          Always allow
                        </button>
                        <button
                          type="button"
                          className="deny"
                          onClick={() => void decide(item, "deny")}
                        >
                          Deny
                        </button>
                      </div>
                    )}
                  </details>
                ) : (
                  <div className="message-bubble">
                    <div className="message-label">
                      {item.role === "user" ? "You" : (selectedBot?.name ?? "Agent")}
                      {item.role === "assistant" && (
                        <button
                          type="button"
                          className="copy-button"
                          onClick={() => void navigator.clipboard.writeText(item.content)}
                        >
                          Copy
                        </button>
                      )}
                    </div>
                    <div className="message-content">{item.content}</div>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : null}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button type="button" onClick={() => setError("")} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {notice && <output className="notice-banner">{notice}</output>}
        {workspace === "chat" && !screenMode && (
          <form
            className={`composer${dragOver ? " dragover" : ""}`}
            onSubmit={(e) => void sendPrompt(e)}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void addDroppedFiles(event.dataTransfer.files).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              );
            }}
          >
            {pendingFiles.length > 0 && (
              <div className="attachment-list">
                {pendingFiles.map((file) => (
                  <span className="attachment-chip" key={file.id}>
                    {file.name}
                    <button
                      type="button"
                      onClick={() =>
                        setPendingFiles((current) => current.filter((item) => item.id !== file.id))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                const node = event.target;
                node.style.height = "0px";
                node.style.height = `${Math.min(180, node.scrollHeight)}px`;
              }}
              placeholder={
                botId ? `Message ${selectedBot?.name ?? "your agent"}` : "Connect and choose a bot"
              }
              disabled={!botId}
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const files = event.target.files;
                if (files?.length)
                  void addDroppedFiles(files).catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
                event.target.value = "";
              }}
            />
            <div className="composer-footer">
              <div className="composer-tools">
                <button
                  type="button"
                  className="icon-button"
                  title="Attach files"
                  disabled={!botId}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Glyph>
                    <path d="M8.2 4.2 4.4 8a2.6 2.6 0 0 0 3.7 3.7l4.6-4.6a1.7 1.7 0 0 0-2.4-2.4L5.8 9.2a.8.8 0 0 0 1.1 1.1l3.6-3.6" />
                  </Glyph>
                </button>
                <span>
                  <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
                  {dragOver ? " · Drop to attach" : ""}
                </span>
              </div>
              <button
                type="submit"
                className="primary"
                disabled={!botId || (!draft.trim() && pendingFiles.length === 0)}
              >
                Send
                <Glyph>
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </Glyph>
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x2000));
  }
  return btoa(binary);
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

function keysym(key: string): number | null {
  if (key.length === 1) return key.charCodeAt(0);
  const named: Record<string, number> = {
    Enter: 0xff0d,
    Backspace: 0xff08,
    Tab: 0xff09,
    Escape: 0xff1b,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
  };
  return named[key] ?? null;
}

function DesktopRequired() {
  return (
    <div className="app-shell">
      <p className="desktop-required">
        The chat UI runs in the Electron window. Keep this Vite server running, then start Electron
        from the repository root with <code>pnpm --filter @agentOS/desktop electron</code>.
      </p>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root mount node is missing");
createRoot(rootElement).render(
  <React.StrictMode>
    {typeof window.agentOS?.onFrame === "function" ? <App /> : <DesktopRequired />}
  </React.StrictMode>,
);
