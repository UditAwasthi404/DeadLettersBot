import {
  AlertDialog,
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  Popover,
  Select,
  Tabs,
  TextArea,
  TextField,
  Theme,
  Tooltip,
} from "@radix-ui/themes";
import {
  ArrowDown,
  ArrowRight,
  Bookmark,
  Computer,
  Copy,
  GitFork,
  Link2,
  ListChecks,
  MessageSquare,
  Monitor,
  Paperclip,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ClerkBridge } from "./ClerkBoundary.tsx";
import { ConnectorBrandIcon } from "./ConnectorBrandIcon.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";
import { RawVncSession } from "./rfb.ts";
import "@radix-ui/themes/styles.css";
import "./style.css";

const AssistantMarkdown = React.lazy(() => import("./AssistantMarkdown.tsx"));
const ClerkBoundary = React.lazy(() =>
  import("./ClerkBoundary.tsx").then((module) => ({ default: module.ClerkBoundary })),
);
const ClerkAuthScreen = React.lazy(() => import("./ClerkAuthScreen.tsx"));

function clerkPublishableKey(): string {
  const mock = import.meta.env.CLERK_MOCK ?? import.meta.env.VITE_CLERK_MOCK;
  if (mock === "1") return "";
  return (
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
    import.meta.env.CLERK_PUBLISHABLE_KEY ||
    ""
  ).trim();
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type AppButtonProps = React.ComponentProps<typeof Button>;

function AppButton({ className, variant, size, ...props }: AppButtonProps) {
  const primary = className?.split(/\s+/).includes("primary") ?? false;
  return (
    <Button
      {...props}
      className={className}
      variant={variant ?? (primary ? "solid" : "ghost")}
      size={size ?? "2"}
    />
  );
}

type AppSelectProps = {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
};

function AppSelect({
  value,
  defaultValue,
  onChange,
  children,
  className,
  "aria-label": ariaLabel,
  disabled,
  required,
  name,
}: AppSelectProps) {
  const options = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>> =>
      React.isValidElement(child) && child.type === "option",
  );
  // Radix Select.Item forbids value=""; map empty options to a sentinel and never
  // pass a controlled value that is missing from the item list (that blanks the UI).
  const emptyOptionValue = "__agentos_empty_option__";
  const placeholder = options.find((option) => option.props.value === "");
  const selectedValue = value == null ? undefined : String(value);
  const initialValue = defaultValue == null ? undefined : String(defaultValue);
  const itemValues = new Set(
    options.map((option, index) => {
      const raw = String(option.props.value ?? index);
      return raw === "" ? emptyOptionValue : raw;
    }),
  );
  const fallbackValue = itemValues.values().next().value as string | undefined;
  const resolve = (raw: string | undefined): string | undefined => {
    if (raw === undefined) return undefined;
    if (itemValues.size === 0) return undefined;
    const candidate = raw === "" ? emptyOptionValue : raw;
    if (itemValues.has(candidate)) return candidate;
    if (placeholder) return emptyOptionValue;
    return fallbackValue;
  };
  const resolvedValue = resolve(selectedValue);
  const resolvedDefault = resolve(initialValue);
  const controlled = value !== undefined;

  return (
    <Select.Root
      value={controlled ? resolvedValue : undefined}
      defaultValue={controlled ? undefined : resolvedDefault}
      onValueChange={(nextValue) => {
        const nextTarget = { value: nextValue === emptyOptionValue ? "" : nextValue };
        onChange?.({ target: nextTarget } as React.ChangeEvent<HTMLSelectElement>);
      }}
      disabled={disabled || itemValues.size === 0}
      required={required}
      name={name}
    >
      <Select.Trigger
        className={`app-select${className ? ` ${className}` : ""}`}
        aria-label={ariaLabel}
        placeholder={
          placeholder ? String(placeholder.props.children ?? "Choose an option") : undefined
        }
      />
      <Select.Content position="popper">
        {options.map((option, index) => {
          const rawValue = String(option.props.value ?? index);
          const optionValue = rawValue === "" ? emptyOptionValue : rawValue;
          return (
            <Select.Item key={optionValue} value={optionValue} disabled={option.props.disabled}>
              {option.props.children ??
                option.props.label ??
                (rawValue === "" ? "Default" : rawValue)}
            </Select.Item>
          );
        })}
      </Select.Content>
    </Select.Root>
  );
}

type LocalPolicy = "never" | "always_confirm" | "always_allow";
type PermissionLevel = 0 | 1 | 2 | 3;
type AutoReviewRule = { actionPattern: string; mode: "require" | "always_allow" };

function exactToolPattern(toolName: string): string {
  return `^${toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

interface Bot {
  id: string;
  name: string;
  role: string;
  inferenceSettings?: { providerId?: string; model?: string };
  localMachineAccess?: LocalPolicy;
  retainData?: boolean;
  approvalSettings?: { autoReviewRules: AutoReviewRule[]; defaultLevel: PermissionLevel };
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
interface MemoryReviewSuggestion {
  id: string;
  memoryId: string;
  turnId: string;
  action: "update" | "delete";
  existingContent: string;
  currentContent: string | null;
  proposedContent: string | null;
  reason: string | null;
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
    | { type: "file_change"; path?: string }
    | {
        type: "connector_event";
        service: "gmail" | "google-calendar";
        sender?: string;
        subject?: string;
        query?: string;
        calendarId?: string;
      };
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
  if (trigger.type === "connector_event")
    return trigger.service === "gmail"
      ? `Gmail event${trigger.sender ? ` from ${trigger.sender}` : ""}${trigger.subject ? ` · ${trigger.subject}` : ""}`
      : `Calendar event${trigger.subject ? ` · ${trigger.subject}` : ""}`;
  const senderName = trigger.senderBotId
    ? (bots.find((bot) => bot.id === trigger.senderBotId)?.name ?? "selected bot")
    : "any bot";
  return `Inter-bot message from ${senderName}`;
}

function subagentToolLabels(allowedTools: string[]): string[] {
  const tools = new Set(allowedTools);
  return [
    tools.has("ReadFile") || tools.has("ListDirectory") ? "Workspace files" : "",
    [...tools].some((tool) => tool.startsWith("Browser")) ? "Browser" : "",
    tools.has("SearchWeb") || tools.has("FetchURL") ? "Web search" : "",
    tools.has("ConnectorCall") ? "Read-only connectors" : "",
  ].filter(Boolean);
}

type ConnectorEventTrigger = Extract<RoutineItem["trigger"], { type: "connector_event" }>;

function connectorEventTriggerFromDraft(input: {
  service: ConnectorEventTrigger["service"];
  sender: string;
  subject: string;
  query: string;
  calendarId: string;
}): ConnectorEventTrigger | null {
  const sender = input.sender.trim();
  const subject = input.subject.trim();
  const query = input.query.trim();
  const calendarId = input.calendarId.trim();
  if (input.service === "google-calendar") {
    if (!subject) return null;
    return {
      type: "connector_event",
      service: input.service,
      subject,
      ...(calendarId ? { calendarId } : {}),
    };
  }
  if (!sender && !subject && !query) return null;
  return {
    type: "connector_event",
    service: input.service,
    ...(sender ? { sender } : {}),
    ...(subject ? { subject } : {}),
    ...(query ? { query } : {}),
  };
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
  lastError: string | null;
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
interface SubagentItem {
  id: string;
  parentBotId: string;
  taskDescription: string;
  allowedTools: string[];
  status: "queued" | "running" | "completed" | "error" | "cancelled" | "stalled";
  result: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  stallCount: number;
  lastProgressAt: string | null;
  stallEvents: Array<{ at: string; reason: string }>;
  steeringEvents: Array<{ at: string; message: string }>;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
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
interface ConfirmationDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
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
  step?: number;
  stepBudget?: number;
  label?: string;
  plan?: string;
  thumbnail?: string;
}

function App({ clerk }: { clerk?: ClerkBridge } = {}) {
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8787");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("disconnected");
  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [activeRun, setActiveRun] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryReviewSuggestions, setMemoryReviewSuggestions] = useState<MemoryReviewSuggestion[]>(
    [],
  );
  const [memoryEditTarget, setMemoryEditTarget] = useState<MemoryEntry | null>(null);
  const [memoryEditDraft, setMemoryEditDraft] = useState("");
  const [memoryEvidence, setMemoryEvidence] = useState<Record<string, MemoryEvidenceEntry[]>>({});
  const [automationOpen, setAutomationOpen] = useState(false);
  const [skillItems, setSkillItems] = useState<SkillItem[]>([]);
  const [skillCreateOpen, setSkillCreateOpen] = useState(false);
  const [skillCreateDescription, setSkillCreateDescription] = useState("");
  const [skillManualName, setSkillManualName] = useState("");
  const [skillManualInstructions, setSkillManualInstructions] = useState("");
  const [skillDrafting, setSkillDrafting] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState("");
  const [skillDraftName, setSkillDraftName] = useState("");
  const [skillDraftDescription, setSkillDraftDescription] = useState("");
  const [skillDraftSteps, setSkillDraftSteps] = useState<SkillStepDraft[]>([]);
  const [routineItems, setRoutineItems] = useState<RoutineItem[]>([]);
  const [routineCreateOpen, setRoutineCreateOpen] = useState(false);
  const [routineCreateType, setRoutineCreateType] = useState<
    "cron" | "webhook" | "inter_bot_message" | "file_change"
  >("cron");
  const [routineCreateName, setRoutineCreateName] = useState("");
  const [routineCreateSkillId, setRoutineCreateSkillId] = useState("");
  const [routineCreateSchedule, setRoutineCreateSchedule] = useState("0 9 * * *");
  const [routineCreateFilePath, setRoutineCreateFilePath] = useState("/home/agent");
  const [routineCreateSenderBotId, setRoutineCreateSenderBotId] = useState("");
  const [routineHistory, setRoutineHistory] = useState<Record<string, RoutineRunItem[]>>({});
  const [editingRoutineId, setEditingRoutineId] = useState("");
  const [routineDraftName, setRoutineDraftName] = useState("");
  const [routineDraftBotId, setRoutineDraftBotId] = useState("");
  const [routineDraftSkillId, setRoutineDraftSkillId] = useState("");
  const [routineDraftSchedule, setRoutineDraftSchedule] = useState("");
  const [routineDraftSenderBotId, setRoutineDraftSenderBotId] = useState("");
  const [routineDraftPath, setRoutineDraftPath] = useState("/home/agent");
  const [routineDraftConnectorService, setRoutineDraftConnectorService] = useState<
    "gmail" | "google-calendar"
  >("gmail");
  const [routineDraftConnectorSender, setRoutineDraftConnectorSender] = useState("");
  const [routineDraftConnectorSubject, setRoutineDraftConnectorSubject] = useState("");
  const [routineDraftConnectorQuery, setRoutineDraftConnectorQuery] = useState("");
  const [routineDraftCalendarId, setRoutineDraftCalendarId] = useState("primary");
  const [newConnectorRoutineOpen, setNewConnectorRoutineOpen] = useState(false);
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
  const [subagentOpen, setSubagentOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventName[]>(["turn.settled"]);
  const [webhookSubscriptions, setWebhookSubscriptions] = useState<WebhookSubscriptionItem[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [subagentItems, setSubagentItems] = useState<SubagentItem[]>([]);
  const [subagentSteering, setSubagentSteering] = useState<Record<string, string>>({});
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
  const shouldAutoScrollRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const screenRef = useRef<HTMLCanvasElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [sendingPrompt, setSendingPrompt] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [approvalRules, setApprovalRules] = useState<AutoReviewRule[]>([]);
  const [approvalDefaultLevel, setApprovalDefaultLevel] = useState<PermissionLevel>(0);
  const [approvalToolName, setApprovalToolName] = useState("");
  const [approvalRuleMode, setApprovalRuleMode] = useState<AutoReviewRule["mode"]>("require");
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authMode, setAuthMode] = useState<"create" | "token">("create");
  const [clerkScreen, setClerkScreen] = useState<"in" | "up">("in");
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
  const confirmationResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const [localAccess, setLocalAccess] = useState<LocalPolicy>("always_confirm");
  const [pendingLocal, setPendingLocal] = useState<{
    agentId: string;
    runId: string;
    actionId: string;
    command: string;
    cwd?: string;
  } | null>(null);

  function requestConfirmation(
    title: string,
    description: string,
    confirmLabel = "Continue",
    destructive = false,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      confirmationResolver.current = resolve;
      setConfirmation({ title, description, confirmLabel, destructive });
    });
  }

  function resolveConfirmation(confirmed: boolean) {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }
  const [allowLocalSession, setAllowLocalSession] = useState(false);
  const [screenMode, setScreenMode] = useState<null | "view" | "control" | "handoff">(null);
  const [agentActivity, setAgentActivity] = useState("");
  const [livePlan, setLivePlan] = useState("");
  const [stepProgress, setStepProgress] = useState<{ step: number; stepBudget: number } | null>(
    null,
  );
  const [pausedRun, setPausedRun] = useState(false);
  const [timeline, setTimeline] = useState<
    Array<{ id: string; label: string; thumbnail?: string }>
  >([]);
  const tokenHold = useRef<{ runId: string; agentId?: string; text: string } | null>(null);
  const tokenPaint = useRef(0);
  const [handoff, setHandoff] = useState<{
    agentId: string;
    runId: string;
    reason: string;
  } | null>(null);
  const screenBotId = screenMode === "handoff" ? handoff?.agentId : botId;

  useEffect(() => {
    const flushTokens = (reason: "paint" | "boundary") => {
      const pending = tokenHold.current;
      tokenHold.current = null;
      if (tokenPaint.current) {
        cancelAnimationFrame(tokenPaint.current);
        tokenPaint.current = 0;
      }
      if (!pending?.text) return;
      setItems((old) => appendAssistantDelta(old, pending));
      if (reason === "paint")
        setAgentActivity((current) => (current === "Replying" ? current : "Replying"));
    };
    const stopFrame = window.agentOS.onFrame((unknownFrame) => {
      const frame = unknownFrame as Frame;
      if (frame.runId) setActiveRun(frame.runId);
      if (frame.type === "token" && frame.runId && frame.delta) {
        const pending = tokenHold.current;
        if (pending && pending.runId === frame.runId) pending.text += frame.delta;
        else {
          flushTokens("boundary");
          tokenHold.current = {
            runId: frame.runId,
            agentId: frame.agentId,
            text: frame.delta,
          };
          setAgentActivity((current) => (current === "Replying" ? current : "Replying"));
        }
        if (!tokenPaint.current) {
          tokenPaint.current = requestAnimationFrame(() => {
            tokenPaint.current = 0;
            flushTokens("paint");
          });
        }
        return;
      }
      flushTokens("boundary");
      if (frame.type === "message") {
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
      } else if (frame.type === "activity") {
        if (typeof frame.step === "number" && typeof frame.stepBudget === "number")
          setStepProgress({ step: frame.step, stepBudget: frame.stepBudget });
        if (typeof frame.plan === "string") setLivePlan(frame.plan);
        if (frame.label) setAgentActivity(frame.label);
        if (frame.label && frame.label !== "Working" && frame.label !== "Following the plan") {
          setTimeline((old) =>
            [
              {
                id: crypto.randomUUID(),
                label: frame.label ?? "Working",
                ...(typeof frame.thumbnail === "string" ? { thumbnail: frame.thumbnail } : {}),
              },
              ...old,
            ].slice(0, 12),
          );
        }
      } else if (frame.type === "toolStart") {
        setAgentActivity(activityLabel(frame.toolName, frame.params));
        setItems((old) => [
          ...old,
          {
            id: crypto.randomUUID(),
            role: "tool",
            toolName: frame.toolName,
            content: previewPayload(frame.params),
            runId: frame.runId,
            agentId: frame.agentId,
          },
        ]);
      } else if (frame.type === "toolEnd") {
        setAgentActivity((current) =>
          frame.toolName === "Computer" || frame.toolName === "BrowserScreenshot"
            ? "Checking the screen"
            : current,
        );
        setItems((old) => [
          ...old,
          {
            id: crypto.randomUUID(),
            role: "tool",
            toolName: `${frame.toolName ?? "Tool"} result`,
            content: previewPayload(frame.result),
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
        setAgentActivity("");
        setPausedRun(false);
      } else if (frame.type === "error") {
        setError(`${frame.code ?? "error"}: ${frame.message ?? "request failed"}`);
        setActiveRun("");
        setAgentActivity("");
      }
    });
    const stopStatus = window.agentOS.onStatus(setStatus);
    const stopPaint = () => {
      if (tokenPaint.current) cancelAnimationFrame(tokenPaint.current);
      tokenPaint.current = 0;
    };
    let active = true;
    if (clerk?.enabled) {
      setSessionReady(true);
      return () => {
        active = false;
        stopPaint();
        stopFrame();
        stopStatus();
        void window.agentOS.disconnect();
      };
    }
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
      stopPaint();
      stopFrame();
      stopStatus();
      void window.agentOS.disconnect();
    };
  }, [clerk?.enabled]);

  useEffect(() => {
    if (!clerk?.enabled || !clerk.loaded || !clerk.signedIn) return;
    let cancelled = false;
    const sync = async (initial: boolean) => {
      try {
        const sessionToken = await clerk.getToken();
        if (cancelled) return;
        if (!sessionToken) {
          if (initial) setAuthError("Clerk signed in but did not provide a session token.");
          return;
        }
        setToken(sessionToken);
        await window.agentOS.updateToken(sessionToken);
        if (!initial) return;
        const ok = await connect({ token: sessionToken });
        if (!ok && !cancelled)
          setAuthError("Clerk signed in, but the gateway rejected the session.");
      } catch (err) {
        if (!cancelled)
          setAuthError(err instanceof Error ? err.message : "Could not connect the Clerk session.");
      }
    };
    void sync(true);
    const timer = setInterval(() => void sync(false), 45_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [clerk?.enabled, clerk?.loaded, clerk?.signedIn, clerk?.getToken]);

  useEffect(() => {
    if (!signedIn || !botId || !baseUrl || !token) {
      setItems([]);
      return;
    }
    let active = true;
    void window.agentOS
      .apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${encodeURIComponent(botId)}/history`,
      })
      .then((result) => {
        if (!active || !result || typeof result !== "object" || !("items" in result)) return;
        const history = (result.items as ChatItem[]).filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.runId === "string" &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string",
        );
        setItems((current) => {
          const live = current.filter(
            (item) =>
              item.role === "tool" ||
              !history.some(
                (saved) =>
                  saved.runId === item.runId &&
                  saved.role === item.role &&
                  (saved.content === item.content ||
                    (item.role === "assistant" && saved.content.startsWith(item.content))),
              ),
          );
          return [...history, ...live];
        });
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            `Could not restore chat history: ${err instanceof Error ? err.message : String(err)}`,
          );
      });
    return () => {
      active = false;
    };
  }, [baseUrl, botId, signedIn, token]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the item list is the scroll trigger; the ref is stable.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (shouldAutoScrollRef.current) {
      node.scrollTop = node.scrollHeight;
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 80);
    }
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
    let pointerFrame = 0;
    let pendingPointer: { x: number; y: number; buttons: number } | null = null;
    const sendPointer = (immediate: boolean) => {
      const next = pendingPointer;
      if (!next) return;
      if (!immediate) {
        if (pointerFrame) return;
        pointerFrame = requestAnimationFrame(() => {
          pointerFrame = 0;
          const point = pendingPointer;
          pendingPointer = null;
          if (point) session.pointer(point.x, point.y, point.buttons);
        });
        return;
      }
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      pendingPointer = null;
      session.pointer(next.x, next.y, next.buttons);
    };
    const point = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      pendingPointer = {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height,
        buttons: event.buttons,
      };
      sendPointer(event.type !== "pointermove");
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
    if (screenMode === "handoff" || screenMode === "control") {
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
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      session.dispose();
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
      try {
        const suggestions = (await window.agentOS.apiRequest({
          baseUrl,
          token,
          path: `/v1/bots/${botId}/memory/reviews`,
        })) as MemoryReviewSuggestion[];
        setMemoryReviewSuggestions(suggestions);
      } catch {
        setMemoryReviewSuggestions([]);
      }
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

  async function loadSecuritySettings() {
    if (!botId || !token) return;
    try {
      const bot = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}`,
      })) as Bot;
      setApprovalRules(bot.approvalSettings?.autoReviewRules ?? []);
      setApprovalDefaultLevel(bot.approvalSettings?.defaultLevel ?? 0);
      setApprovalToolName("");
      showWorkspace("security");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveApprovalSettings() {
    if (!botId || approvalSaving) return;
    setApprovalSaving(true);
    try {
      const approvalSettings = {
        autoReviewRules: approvalRules,
        defaultLevel: approvalDefaultLevel,
      };
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}`,
        method: "PATCH",
        body: { approvalSettings },
      });
      setBots((current) =>
        current.map((bot) => (bot.id === botId ? { ...bot, approvalSettings } : bot)),
      );
      setNotice("Approval settings saved. They apply to new tool calls.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApprovalSaving(false);
    }
  }

  function addApprovalRule(event: React.FormEvent) {
    event.preventDefault();
    const toolName = approvalToolName.trim();
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(toolName)) {
      setError("Enter a tool name using letters, numbers, dots, underscores, colons, or hyphens.");
      return;
    }
    const actionPattern = exactToolPattern(toolName);
    setApprovalRules((current) => [
      ...current.filter((rule) => rule.actionPattern !== actionPattern),
      { actionPattern, mode: approvalRuleMode },
    ]);
    setApprovalToolName("");
    setError("");
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

  function openSkillCreate() {
    setSkillCreateDescription("");
    setSkillManualName("");
    setSkillManualInstructions("");
    setSkillCreateOpen(true);
  }

  async function draftSkillFromDescription(event: React.FormEvent) {
    event.preventDefault();
    const description = skillCreateDescription.trim();
    if (!description || description.length > 6000) {
      setError("Describe the task in 1 to 6,000 characters.");
      return;
    }
    setSkillDrafting(true);
    setError("");
    try {
      const draft = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/skills/draft",
        method: "POST",
        body: { description },
      })) as {
        name: string;
        description: string;
        steps: Array<{ instruction: string; approvalRequired?: boolean }>;
      };
      setTaughtDraft({
        name: draft.name,
        description: draft.description,
        steps: draft.steps.map((step) => ({
          id: crypto.randomUUID(),
          instruction: step.instruction,
          approvalRequired: step.approvalRequired ?? false,
          onError: "stop",
          maxAttempts: 3,
          customPrompt: "",
        })),
      });
      setSkillCreateOpen(false);
      setSkillCreateDescription("");
      showWorkspace("automation");
      setNotice("Draft created. Review the steps and approval points before saving.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSkillDrafting(false);
    }
  }

  async function createSkillManually(event: React.FormEvent) {
    event.preventDefault();
    const instructions = skillManualInstructions
      .split("\n")
      .map((instruction) => instruction.trim())
      .filter(Boolean);
    if (!skillManualName.trim() || !instructions.length) {
      setError("Add a skill name and at least one instruction.");
      return;
    }
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/skills",
        method: "POST",
        body: {
          name: skillManualName.trim(),
          description: instructions[0] ?? "",
          steps: instructions.map((instruction) => ({ instruction })),
        },
      });
      setSkillCreateOpen(false);
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
    if (
      !(await requestConfirmation(
        `Delete “${skill.name}”?`,
        "This removes the skill from this account. Routines that depend on it may stop working.",
        "Delete skill",
        true,
      ))
    )
      return;
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

  function beginConnectorRoutine() {
    const targetBotId = botId || bots.find((bot) => bot.role !== "subagent")?.id || "";
    const skill = skillItems.find((item) => !item.ownerBotId || item.ownerBotId === targetBotId);
    if (!targetBotId || !skill) {
      setError("Choose a bot with a compatible skill before creating a connector routine.");
      return;
    }
    setRoutineDraftName(`${skill.name} event routine`);
    setRoutineDraftBotId(targetBotId);
    setRoutineDraftSkillId(skill.id);
    setRoutineDraftConnectorService("gmail");
    setRoutineDraftConnectorSender("");
    setRoutineDraftConnectorSubject("");
    setRoutineDraftConnectorQuery("");
    setRoutineDraftCalendarId("primary");
    setRoutineDraftOnError("pause");
    setNewConnectorRoutineOpen(true);
  }

  async function saveConnectorRoutine(event: React.FormEvent) {
    event.preventDefault();
    if (!routineDraftName.trim() || !routineDraftBotId || !routineDraftSkillId) {
      setError("Routine name, bot, and skill are required.");
      return;
    }
    const trigger = connectorEventTriggerFromDraft({
      service: routineDraftConnectorService,
      sender: routineDraftConnectorSender,
      subject: routineDraftConnectorSubject,
      query: routineDraftConnectorQuery,
      calendarId: routineDraftCalendarId,
    });
    if (!trigger) {
      setError(
        routineDraftConnectorService === "gmail"
          ? "Add a sender, subject, or Gmail search query filter."
          : "Add an event title filter for Google Calendar.",
      );
      return;
    }
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/routines",
        method: "POST",
        body: {
          botId: routineDraftBotId,
          skillId: routineDraftSkillId,
          name: routineDraftName.trim(),
          trigger,
          onError: routineDraftOnError,
        },
      });
      setNewConnectorRoutineOpen(false);
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openRoutineCreate(
    triggerType: "cron" | "webhook" | "inter_bot_message" | "file_change" = "cron",
  ) {
    const skill = skillItems.find((item) => !item.ownerBotId || item.ownerBotId === botId);
    if (!skill) {
      setError("Create or copy a skill to the selected bot before scheduling a routine.");
      return;
    }
    setRoutineCreateType(triggerType);
    setRoutineCreateName(skill.name);
    setRoutineCreateSkillId(skill.id);
    setRoutineCreateSchedule("0 9 * * *");
    setRoutineCreateFilePath("/home/agent");
    setRoutineCreateSenderBotId("");
    setRoutineCreateOpen(true);
  }

  async function createRoutine(event: React.FormEvent) {
    event.preventDefault();
    const skill = skillItems.find((item) => item.id === routineCreateSkillId);
    if (!routineCreateName.trim() || !skill || (skill.ownerBotId && skill.ownerBotId !== botId)) {
      setError("Routine name and a skill available to the selected bot are required.");
      return;
    }
    const senders = bots.filter((bot) => bot.id !== botId && bot.role !== "subagent");
    if (routineCreateSenderBotId && !senders.some((bot) => bot.id === routineCreateSenderBotId)) {
      setError("Choose an available sender bot or select any bot.");
      return;
    }
    if (routineCreateType === "cron" && !routineCreateSchedule.trim()) {
      setError("Enter a five-field cron schedule.");
      return;
    }
    if (routineCreateType === "file_change" && !routineCreateFilePath.trim()) {
      setError("Enter a path inside /home/agent.");
      return;
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
          name: routineCreateName.trim(),
          trigger:
            routineCreateType === "cron"
              ? { type: "cron", schedule: routineCreateSchedule.trim() }
              : routineCreateType === "webhook"
                ? { type: "webhook" }
                : routineCreateType === "file_change"
                  ? { type: "file_change", path: routineCreateFilePath.trim() }
                  : {
                      type: "inter_bot_message",
                      ...(routineCreateSenderBotId
                        ? { senderBotId: routineCreateSenderBotId }
                        : {}),
                    },
        },
      })) as { routine: RoutineItem; webhookSecret?: string };
      setRoutineCreateOpen(false);
      if (routineCreateType === "webhook" && created.webhookSecret)
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
    setRoutineDraftConnectorService(
      routine.trigger.type === "connector_event" ? routine.trigger.service : "gmail",
    );
    setRoutineDraftConnectorSender(
      routine.trigger.type === "connector_event" ? (routine.trigger.sender ?? "") : "",
    );
    setRoutineDraftConnectorSubject(
      routine.trigger.type === "connector_event" ? (routine.trigger.subject ?? "") : "",
    );
    setRoutineDraftConnectorQuery(
      routine.trigger.type === "connector_event" ? (routine.trigger.query ?? "") : "",
    );
    setRoutineDraftCalendarId(
      routine.trigger.type === "connector_event"
        ? (routine.trigger.calendarId ?? "primary")
        : "primary",
    );
    setRoutineDraftOnError(routine.onError ?? "pause");
  }

  async function saveRoutineEdit(routine: RoutineItem) {
    const assignmentChanged =
      routineDraftBotId !== routine.botId || routineDraftSkillId !== routine.skillId;
    if (
      assignmentChanged &&
      !(await requestConfirmation(
        `Reassign “${routine.name}”?`,
        "Future runs will use the selected bot and skill.",
        "Reassign",
      ))
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
    if (routine.trigger.type === "connector_event") {
      const connectorFilter =
        routineDraftConnectorService === "gmail"
          ? routineDraftConnectorSender.trim() ||
            routineDraftConnectorSubject.trim() ||
            routineDraftConnectorQuery.trim()
          : routineDraftConnectorSubject.trim();
      if (!connectorFilter) {
        setError(
          routineDraftConnectorService === "gmail"
            ? "Add at least one sender, subject, or Gmail query filter."
            : "Add an event title filter for a Google Calendar routine.",
        );
        return;
      }
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
                : routine.trigger.type === "connector_event"
                  ? {
                      trigger: {
                        type: "connector_event",
                        service: routineDraftConnectorService,
                        ...(routineDraftConnectorService === "gmail" &&
                        routineDraftConnectorSender.trim()
                          ? { sender: routineDraftConnectorSender.trim() }
                          : {}),
                        ...(routineDraftConnectorSubject.trim()
                          ? { subject: routineDraftConnectorSubject.trim() }
                          : {}),
                        ...(routineDraftConnectorService === "gmail" &&
                        routineDraftConnectorQuery.trim()
                          ? { query: routineDraftConnectorQuery.trim() }
                          : {}),
                        ...(routineDraftConnectorService === "google-calendar" &&
                        routineDraftCalendarId.trim()
                          ? { calendarId: routineDraftCalendarId.trim() }
                          : {}),
                      },
                    }
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
          !(await requestConfirmation(
            `Run “${routine.name}” now?`,
            "This runs its skill immediately and may perform configured external actions.",
            "Run now",
          ))
        )
          return;
        await window.agentOS.apiRequest({
          baseUrl,
          token,
          path: `/v1/routines/${routine.id}/test`,
          method: "POST",
        });
      } else if (update.delete) {
        if (
          !(await requestConfirmation(
            `Delete “${routine.name}”?`,
            "This removes the routine and its run history.",
            "Delete routine",
            true,
          ))
        )
          return;
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

  async function loadSubagents(open = true) {
    try {
      const rows = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/subagents",
      })) as SubagentItem[];
      setSubagentItems(rows);
      if (open) showWorkspace("subagents");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelSubagent(item: SubagentItem) {
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/subagents/${encodeURIComponent(item.id)}/cancel`,
        method: "POST",
      });
      await loadSubagents(false);
      setNotice("Cancellation requested.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadSubagents(false);
    }
  }

  async function steerSubagent(item: SubagentItem) {
    const message = subagentSteering[item.id]?.trim();
    if (!message) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/subagents/${encodeURIComponent(item.id)}/steer`,
        method: "POST",
        body: { message },
      });
      setSubagentSteering((current) => ({ ...current, [item.id]: "" }));
      await loadSubagents(false);
      setNotice("Guidance sent to the subagent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadSubagents(false);
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
    if (
      !(await requestConfirmation(
        "Delete this webhook subscription?",
        subscription.url,
        "Delete webhook",
        true,
      ))
    )
      return;
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
    if (
      !(await requestConfirmation(
        `Remove “${server.name}”?`,
        "The agent will no longer be able to call this server's tools.",
        "Remove server",
        true,
      ))
    )
      return;
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
      })) as {
        name: string;
        description: string;
        steps: Array<{ instruction: string; approvalRequired?: boolean }>;
      };
      setTaughtDraft({
        name: draft.name,
        description: draft.description,
        steps: draft.steps.map((step) => ({
          id: crypto.randomUUID(),
          instruction: step.instruction,
          approvalRequired: step.approvalRequired ?? false,
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
    if (
      !taughtDraft?.name.trim() ||
      !taughtDraft.steps.length ||
      taughtDraft.steps.some(
        (step) => !step.instruction.trim() || step.instruction.trim().length > 4000,
      ) ||
      taughtDraft.description.length > 2000
    ) {
      setError("Add a name, description under 2,000 characters, and 1–20 valid steps.");
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
          steps: taughtDraft.steps.map((step) => ({
            instruction: step.instruction.trim(),
            approvalRequired: step.approvalRequired,
          })),
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
      !(await requestConfirmation(
        `Test “${skill.name}” now?`,
        "The run uses real tools and can change files, websites, and connected services.",
        "Start test",
      ))
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
    if (
      !(await requestConfirmation(
        `Disconnect ${service}?`,
        "AgentOS will remove the saved connection and ask the provider to revoke access.",
        "Disconnect",
        true,
      ))
    )
      return;
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
    setMemoryEditTarget(memory);
    setMemoryEditDraft(memory.content);
  }

  async function saveMemoryEdit(event: React.FormEvent) {
    event.preventDefault();
    const memory = memoryEditTarget;
    const content = memoryEditDraft.trim();
    if (!memory || !content || content === memory.content) {
      setMemoryEditTarget(null);
      return;
    }
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}/memory/${memory.id}`,
        method: "PATCH",
        body: { content },
      });
      setMemoryEditTarget(null);
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
    if (
      !(await requestConfirmation(
        "Delete this memory?",
        "The agent will no longer use this fact as context.",
        "Delete memory",
        true,
      ))
    )
      return;
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

  async function resolveMemoryReview(
    suggestion: MemoryReviewSuggestion,
    action: "accept" | "reject",
  ) {
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: `/v1/bots/${botId}/memory/reviews/${suggestion.id}`,
        method: "POST",
        body: { action },
      });
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadMemories();
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
    if (sendingPrompt) return;
    const prompt = draft.trim();
    const attachments = pendingFiles;
    if ((!prompt && attachments.length === 0) || !botId) return;
    const names = attachments.map((file) => file.name).join("\n");
    const optimisticMessageId = crypto.randomUUID();
    setItems((old) => [
      ...old,
      {
        id: optimisticMessageId,
        role: "user",
        content: [prompt, names].filter(Boolean).join("\n"),
        agentId: botId,
      },
    ]);
    setDraft("");
    setPendingFiles([]);
    setError("");
    setSendingPrompt(true);
    try {
      await window.agentOS.send({
        type: "sendPrompt",
        agentId: botId,
        prompt,
        attachments,
        nonce: crypto.randomUUID(),
      });
    } catch (err) {
      setItems((old) => old.filter((item) => item.id !== optimisticMessageId));
      setDraft((current) => current || prompt);
      setPendingFiles((current) => (current.length ? current : attachments));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingPrompt(false);
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
    next:
      | "chat"
      | "memory"
      | "security"
      | "automation"
      | "connectors"
      | "webhooks"
      | "subagents"
      | "local"
      | "model",
  ) {
    setMemoryOpen(next === "memory");
    setSecurityOpen(next === "security");
    setAutomationOpen(next === "automation");
    setConnectorOpen(next === "connectors");
    setWebhookOpen(next === "webhooks");
    setSubagentOpen(next === "subagents");
    setLocalOpen(next === "local");
    setModelOpen(next === "model");
    setConnectOpen(false);
    if (next === "chat") {
      shouldAutoScrollRef.current = true;
      setShowJumpToLatest(false);
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      });
    } else {
      setScreenMode((mode) => (mode === "handoff" ? mode : null));
    }
  }

  function handleConversationScroll() {
    const node = scrollRef.current;
    if (!node) return;
    const atLatest = node.scrollHeight - node.scrollTop - node.clientHeight <= 80;
    shouldAutoScrollRef.current = atLatest;
    setShowJumpToLatest(!atLatest);
  }

  function jumpToLatest() {
    shouldAutoScrollRef.current = true;
    setShowJumpToLatest(false);
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }

  const selectedBot = bots.find((bot) => bot.id === botId);
  const visibleBots = bots.filter((bot) =>
    bot.name.toLowerCase().includes(botQuery.trim().toLowerCase()),
  );
  const workspace = webhookOpen
    ? "webhooks"
    : subagentOpen
      ? "subagents"
      : securityOpen
        ? "security"
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
      : workspace === "security"
        ? "Security & approvals"
        : workspace === "automation"
          ? "Skills & routines"
          : workspace === "connectors"
            ? "Connectors"
            : workspace === "webhooks"
              ? "Webhooks"
              : workspace === "subagents"
                ? "Subagents"
                : workspace === "local"
                  ? "This computer"
                  : workspace === "model"
                    ? "Model & privacy"
                    : (selectedBot?.name ?? "Choose a bot");
  const workspaceSubtitle =
    workspace === "chat"
      ? activeRun
        ? agentActivity || "Working"
        : (selectedBot?.role ?? "Agent conversation")
      : (selectedBot?.name ?? "Workspace");

  useEffect(() => {
    if (workspace !== "subagents" || !signedIn || !token) return;
    const timer = window.setInterval(() => {
      void window.agentOS
        .apiRequest({ baseUrl, token, path: "/v1/subagents" })
        .then((rows) => setSubagentItems(rows as SubagentItem[]))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [workspace, signedIn, token, baseUrl]);

  return (
    <div className="app-shell">
      {!signedIn && clerk?.enabled && (
        <section className="auth-gate" aria-label="Account">
          <div className="auth-card">
            <div className="auth-mark">A</div>
            <h1>{clerk.signedIn ? "Signing in" : "Sign in"}</h1>
            <p>
              {clerk.loaded
                ? "Sign in with Clerk. Gmail, Drive, and the other connectors stay separate and are connected later."
                : "Loading sign-in…"}
            </p>
            {clerk.loaded && (
              <label htmlFor="agentos-control-01">
                Gateway
                <TextField.Root
                  id="agentos-control-01"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  spellCheck={false}
                  autoComplete="url"
                  className="app-field"
                />
              </label>
            )}
            {clerk.loaded && !clerk.signedIn && (
              <>
                <React.Suspense fallback={<p>Loading secure sign-in…</p>}>
                  <ClerkAuthScreen mode={clerkScreen} />
                </React.Suspense>
                <AppButton
                  type="button"
                  className="auth-switch"
                  onClick={() => setClerkScreen((current) => (current === "in" ? "up" : "in"))}
                >
                  {clerkScreen === "in" ? "Create a new account" : "I already have an account"}
                </AppButton>
              </>
            )}
            {clerk.loaded && clerk.signedIn && <p>Checking the gateway session…</p>}
            {authError && (
              <p className="auth-error" role="alert">
                {authError}
              </p>
            )}
          </div>
        </section>
      )}
      {!signedIn && !clerk?.enabled && (
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
                <label htmlFor="agentos-control-02">
                  Name
                  <TextField.Root
                    id="agentos-control-02"
                    ref={accountNameRef}
                    value={accountName}
                    onChange={(event) => setAccountName(event.target.value)}
                    placeholder="Your name"
                    maxLength={80}
                    autoComplete="name"
                    className="app-field"
                  />
                </label>
                <label htmlFor="agentos-control-03">
                  Email
                  <TextField.Root
                    id="agentos-control-03"
                    value={accountEmail}
                    onChange={(event) => setAccountEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    className="app-field"
                  />
                </label>
              </>
            )}
            {sessionReady && authMode === "token" && (
              <label htmlFor="agentos-control-04">
                Account token
                <TextField.Root
                  id="agentos-control-04"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  placeholder="Paste token"
                  autoComplete="current-password"
                  spellCheck={false}
                  className="app-field"
                />
              </label>
            )}
            {sessionReady && (
              <label htmlFor="agentos-control-05">
                Gateway
                <TextField.Root
                  id="agentos-control-05"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  spellCheck={false}
                  autoComplete="url"
                  className="app-field"
                />
              </label>
            )}
            {authError && (
              <p className="auth-error" role="alert">
                {authError}
              </p>
            )}
            {sessionReady && (
              <AppButton type="submit" className="primary" disabled={authBusy}>
                {authBusy
                  ? "Creating account…"
                  : authMode === "create"
                    ? "Create account"
                    : "Sign in"}
              </AppButton>
            )}
            {sessionReady &&
              (authMode === "create" ? (
                <AppButton
                  type="button"
                  className="auth-switch"
                  onClick={() => {
                    setAuthMode("token");
                    setAuthError("");
                  }}
                >
                  I already have a token
                </AppButton>
              ) : (
                <AppButton
                  type="button"
                  className="auth-switch"
                  onClick={() => {
                    setAuthMode("create");
                    setAuthError("");
                  }}
                >
                  Create a new account
                </AppButton>
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
          <Tooltip content="Chat" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "chat" ? "active" : ""}`}
              title="Chat"
              aria-current={workspace === "chat" ? "page" : undefined}
              onClick={() => showWorkspace("chat")}
            >
              <MessageSquare className="glyph" aria-hidden="true" />
              Chat
            </Button>
          </Tooltip>
          <Tooltip content="Memory" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "memory" ? "active" : ""}`}
              title="Memory"
              aria-current={workspace === "memory" ? "page" : undefined}
              disabled={!botId}
              onClick={() => void loadMemories()}
            >
              <Bookmark className="glyph" aria-hidden="true" />
              Memory
            </Button>
          </Tooltip>
          <Tooltip content="Security & approvals" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "security" ? "active" : ""}`}
              title="Security & approvals"
              aria-current={workspace === "security" ? "page" : undefined}
              disabled={!botId || !token}
              onClick={() => void loadSecuritySettings()}
            >
              <ShieldCheck className="glyph" aria-hidden="true" />
              Security
            </Button>
          </Tooltip>
          <Tooltip content="Automations" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "automation" ? "active" : ""}`}
              title="Automations"
              aria-current={workspace === "automation" ? "page" : undefined}
              disabled={!token}
              onClick={() => void loadAutomations()}
            >
              <ListChecks className="glyph" aria-hidden="true" />
              Automations
            </Button>
          </Tooltip>
          <Tooltip content="Subagents" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "subagents" ? "active" : ""}`}
              title="Subagents"
              aria-current={workspace === "subagents" ? "page" : undefined}
              disabled={!token}
              onClick={() => void loadSubagents()}
            >
              <GitFork className="glyph" aria-hidden="true" />
              Subagents
            </Button>
          </Tooltip>
          <Tooltip content="Connectors" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "connectors" ? "active" : ""}`}
              title="Connectors"
              aria-current={workspace === "connectors" ? "page" : undefined}
              disabled={!token}
              onClick={() => void loadConnectors()}
            >
              <Link2 className="glyph" aria-hidden="true" />
              Connectors
            </Button>
          </Tooltip>
          <Tooltip content="Webhooks" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "webhooks" ? "active" : ""}`}
              title="Webhooks"
              aria-current={workspace === "webhooks" ? "page" : undefined}
              disabled={!token}
              onClick={() => void loadWebhooks()}
            >
              <Sparkles className="glyph" aria-hidden="true" />
              Webhooks
            </Button>
          </Tooltip>
          <Tooltip content="Model settings" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "model" ? "active" : ""}`}
              title="Model settings"
              aria-current={workspace === "model" ? "page" : undefined}
              disabled={!botId}
              onClick={() => void loadInferenceSettings()}
            >
              <Settings2 className="glyph" aria-hidden="true" />
              Model
            </Button>
          </Tooltip>
          <Tooltip content="This computer" side="right" delayDuration={250}>
            <Button
              type="button"
              variant="ghost"
              className={`nav-item ${workspace === "local" ? "active" : ""}`}
              title="This computer"
              aria-current={workspace === "local" ? "page" : undefined}
              disabled={!botId}
              onClick={() => void openLocalSettings()}
            >
              <Computer className="glyph" aria-hidden="true" />
              This computer
            </Button>
          </Tooltip>
        </nav>
        <div className="roster-head">
          <span>Bots</span>
          <AppButton
            type="button"
            className="icon-button"
            title="New bot (Ctrl+N)"
            aria-label="Create a new bot"
            onClick={() => {
              setBotDraftName("");
              setBotDraftOpen(true);
            }}
            disabled={!token}
          >
            <Plus aria-hidden="true" size={16} />
          </AppButton>
        </div>
        <TextField.Root
          className="app-field sidebar-search"
          value={botQuery}
          onChange={(event) => setBotQuery(event.target.value)}
          placeholder="Search bots"
          aria-label="Search bots"
        />
        <div className="roster">
          {visibleBots.map((bot) => (
            <AppButton
              type="button"
              key={bot.id}
              className={`bot-row ${bot.id === botId ? "selected" : ""}`}
              title={`${bot.name} · ${bot.role}`}
              aria-label={`${bot.name}, ${bot.role}`}
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
            </AppButton>
          ))}
          {!bots.length && <p className="empty-note">Connect to load your bots.</p>}
          {!!bots.length && !visibleBots.length && (
            <p className="empty-note">No bots match that search.</p>
          )}
        </div>
        <div className="sidebar-footer">
          <Popover.Root open={connectOpen} onOpenChange={setConnectOpen}>
            <Popover.Trigger>
              <AppButton
                type="button"
                className="account-row"
                variant="ghost"
                aria-label={`Connection settings: ${status === "connected" ? "connected" : "not connected"} to ${gatewayHost(baseUrl)}`}
                title={`Connection settings · ${status === "connected" ? "Connected" : "Not connected"} · ${gatewayHost(baseUrl)}`}
              >
                <i className={status === "connected" ? "online" : ""} />
                <span>
                  <strong>{status === "connected" ? "Connected" : "Not connected"}</strong>
                  <small>{gatewayHost(baseUrl)}</small>
                </span>
              </AppButton>
            </Popover.Trigger>
            <Popover.Content className="connect-popover" side="top" align="start" sideOffset={8}>
              <form
                className="connect-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect();
                }}
              >
                <label htmlFor="agentos-control-06">
                  Gateway URL
                  <TextField.Root
                    id="agentos-control-06"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    spellCheck={false}
                    className="app-field"
                  />
                </label>
                <label htmlFor="agentos-control-07">
                  Bearer token
                  <TextField.Root
                    id="agentos-control-07"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    type="password"
                    placeholder="Account token"
                    autoComplete="current-password"
                    className="app-field"
                  />
                </label>
                <div className="popover-actions">
                  <AppButton type="submit" className="primary">
                    Connect
                  </AppButton>
                  <AppButton
                    type="button"
                    onClick={() => {
                      void window.agentOS.disconnect();
                      if (clerk?.enabled) void clerk.signOut();
                      setSignedIn(false);
                      setAuthMode(token ? "token" : "create");
                      setAuthError("");
                    }}
                    disabled={status !== "connected"}
                  >
                    Disconnect
                  </AppButton>
                </div>
              </form>
            </Popover.Content>
          </Popover.Root>
        </div>
      </aside>
      <main className="chat-panel">
        <ErrorBoundary key={workspace} fallbackTitle="This panel hit a display error">
          <UpdateBanner
            ready={updateReady}
            onRestart={() => void window.agentOS.restartToUpdate()}
          />
          <header className="chat-header">
            <div className="title-block">
              <strong>{workspaceTitle}</strong>
              <span>
                {activeRun && workspace === "chat" && <i className="working-dot" />}
                {workspaceSubtitle}
              </span>
            </div>
            <div className="header-actions">
              {showJumpToLatest && workspace === "chat" && (
                <AppButton
                  type="button"
                  className="jump-to-latest"
                  aria-label="Jump to latest message"
                  title="Jump to latest message"
                  onClick={jumpToLatest}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                  Latest
                </AppButton>
              )}
              {activeRun && (
                <AppButton
                  type="button"
                  className="stop-button"
                  onClick={() =>
                    void window.agentOS.send({
                      type: "interrupt",
                      agentId: botId,
                      runId: activeRun,
                    })
                  }
                >
                  <Square size={11} fill="currentColor" aria-hidden="true" />
                  Stop
                </AppButton>
              )}
              <AppButton
                type="button"
                className={screenMode === "view" ? "primary" : ""}
                onClick={() => setScreenMode((mode) => (mode === "view" ? null : "view"))}
                disabled={!botId || screenMode === "handoff"}
              >
                <Monitor className="glyph" aria-hidden="true" />
                {screenMode === "view" ? "Hide screen" : "Agent screen"}
              </AppButton>
            </div>
          </header>
          <Dialog.Root open={botDraftOpen} onOpenChange={setBotDraftOpen}>
            <Dialog.Content maxWidth="460px">
              <Dialog.Title>New bot</Dialog.Title>
              <Dialog.Description>
                Give this agent a name. You can change its model after it is created.
              </Dialog.Description>
              <form
                className="skill-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createBot(botDraftName);
                }}
              >
                <label htmlFor="agentos-control-08">
                  Name
                  <TextField.Root
                    id="agentos-control-08"
                    value={botDraftName}
                    onChange={(event) => setBotDraftName(event.target.value)}
                    placeholder="Name"
                    maxLength={80}
                    required
                    className="app-field"
                  />
                </label>
                <div className="memory-actions">
                  <Dialog.Close>
                    <AppButton type="button">Cancel</AppButton>
                  </Dialog.Close>
                  <AppButton
                    type="submit"
                    className="primary"
                    disabled={!botDraftName.trim() || !token}
                  >
                    Create
                  </AppButton>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Root>
          {workspace === "security" && (
            <section className="messages memory-view security-view">
              <div className="memory-toolbar">
                <div>
                  <h2>Security & approvals</h2>
                  <p className="empty-note">
                    Choose how this bot handles tool permissions and exceptions.
                  </p>
                </div>
                <AppButton type="button" onClick={() => showWorkspace("chat")}>
                  Back to chat
                </AppButton>
              </div>
              <article className="memory-entry security-policy-card">
                <h3>Default permission level</h3>
                <div className="approval-default-field">
                  <span>For tools without an Auto Review rule</span>
                  <Select.Root
                    value={
                      ["0", "1", "2", "3"].includes(String(approvalDefaultLevel))
                        ? String(approvalDefaultLevel)
                        : "0"
                    }
                    onValueChange={(value) =>
                      setApprovalDefaultLevel(Number(value) as PermissionLevel)
                    }
                  >
                    <Select.Trigger aria-label="Default permission level" />
                    <Select.Content position="popper">
                      <Select.Item value="0">Use each tool's default</Select.Item>
                      <Select.Item value="1">Ask once per tool</Select.Item>
                      <Select.Item value="2">Ask every time</Select.Item>
                      <Select.Item value="3">Require screen handoff</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </div>
                <p>
                  Higher levels add more review. Screen handoff pauses the bot and gives you control
                  of its browser session.
                </p>
              </article>
              <article className="memory-entry security-policy-card">
                <h3>Auto Review rules</h3>
                <p>
                  Match an exact tool name. “Ask every time” opens the approval dialog for each
                  call; “Always allow” skips approval for that tool. If several rules match, “Ask
                  every time” takes precedence.
                </p>
                <form className="approval-rule-form" onSubmit={addApprovalRule}>
                  <div className="approval-rule-field">
                    <span>Tool name</span>
                    <TextField.Root
                      value={approvalToolName}
                      onChange={(event) => setApprovalToolName(event.target.value)}
                      placeholder="RunShell or BrowserNavigate"
                      maxLength={128}
                      aria-label="Exact tool name"
                      className="app-field"
                    />
                  </div>
                  <div className="approval-rule-field">
                    <span>Rule</span>
                    <Select.Root
                      value={
                        approvalRuleMode === "always_allow" || approvalRuleMode === "require"
                          ? approvalRuleMode
                          : "require"
                      }
                      onValueChange={(value) =>
                        setApprovalRuleMode(value as AutoReviewRule["mode"])
                      }
                    >
                      <Select.Trigger aria-label="Auto Review action" />
                      <Select.Content position="popper">
                        <Select.Item value="require">Ask every time</Select.Item>
                        <Select.Item value="always_allow">Always allow</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </div>
                  <AppButton type="submit" disabled={!approvalToolName.trim()}>
                    <Plus size={15} aria-hidden="true" />
                    Add rule
                  </AppButton>
                </form>
                {approvalRules.length ? (
                  <div className="approval-rule-list">
                    {approvalRules.map((rule, index) => (
                      <div className="approval-rule-row" key={`${rule.actionPattern}-${index}`}>
                        <code>{rule.actionPattern}</code>
                        <Badge color={rule.mode === "require" ? "amber" : "green"} variant="soft">
                          {rule.mode === "require" ? "Ask every time" : "Always allow"}
                        </Badge>
                        <AppButton
                          type="button"
                          aria-label={`Remove rule ${rule.actionPattern}`}
                          title="Remove rule"
                          onClick={() =>
                            setApprovalRules((current) =>
                              current.filter((_, item) => item !== index),
                            )
                          }
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </AppButton>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-note">No custom rules. The tool defaults will apply.</p>
                )}
                <div className="memory-actions">
                  <AppButton
                    type="button"
                    className="primary"
                    disabled={!token || approvalSaving}
                    onClick={() => void saveApprovalSettings()}
                  >
                    {approvalSaving ? "Saving…" : "Save approval settings"}
                  </AppButton>
                </div>
              </article>
            </section>
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
              <AppButton type="button" onClick={() => showWorkspace("chat")}>
                Back to chat
              </AppButton>
            </section>
          )}
          <Dialog.Root
            open={pendingLocal !== null}
            onOpenChange={(open) => {
              // Keep the approval request visible until the user explicitly allows or blocks it.
              if (open) return;
            }}
          >
            {pendingLocal && (
              <Dialog.Content
                className="local-exec-dialog"
                maxWidth="460px"
                onEscapeKeyDown={(event) => event.preventDefault()}
                onPointerDownOutside={(event) => event.preventDefault()}
                onInteractOutside={(event) => event.preventDefault()}
              >
                <Dialog.Title>Run on this computer?</Dialog.Title>
                <Dialog.Description>
                  The agent is asking to run this command on your desktop. Review it before
                  allowing.
                </Dialog.Description>
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
                  <AppButton
                    type="button"
                    className="primary"
                    onClick={() => void replyLocal(allowLocalSession ? "allow_session" : "allow")}
                  >
                    Run
                  </AppButton>
                  <AppButton type="button" className="deny" onClick={() => void replyLocal("deny")}>
                    Block
                  </AppButton>
                </div>
              </Dialog.Content>
            )}
          </Dialog.Root>
          {screenMode && screenBotId && (
            <section className="screen-view">
              <div className="screen-toolbar">
                <p className="screen-status">
                  <i className={agentActivity ? "working-dot" : ""} />
                  {screenMode === "handoff"
                    ? handoff?.reason
                    : screenMode === "control"
                      ? "You have the pointer. Resume to hand it back."
                      : agentActivity || "Viewing the agent screen. The turn keeps running."}
                  {stepProgress ? ` · step ${stepProgress.step}/${stepProgress.stepBudget}` : ""}
                </p>
                {screenMode !== "handoff" && activeRun ? (
                  <div className="screen-controls">
                    <AppButton
                      type="button"
                      onClick={() => {
                        setPausedRun(true);
                        setScreenMode("control");
                        void window.agentOS.send({
                          type: "pause",
                          agentId: screenBotId,
                          runId: activeRun,
                        });
                      }}
                    >
                      Take over
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => {
                        const next = !pausedRun;
                        setPausedRun(next);
                        if (!next && screenMode === "control") setScreenMode("view");
                        void window.agentOS.send({
                          type: next ? "pause" : "resume",
                          agentId: screenBotId,
                          runId: activeRun,
                        });
                      }}
                    >
                      {pausedRun ? "Resume" : "Pause"}
                    </AppButton>
                  </div>
                ) : null}
              </div>
              {livePlan ? <p className="screen-plan">{livePlan}</p> : null}
              {timeline.length ? (
                <div className="screen-timeline">
                  {timeline.map((item) => (
                    <figure key={item.id}>
                      {item.thumbnail ? (
                        <img alt="" src={`data:image/jpeg;base64,${item.thumbnail}`} />
                      ) : (
                        <span />
                      )}
                      <figcaption>{item.label}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
              <canvas ref={screenRef} width={1280} height={800} />
              {screenMode === "handoff" ? (
                <AppButton type="button" onClick={() => void returnControl()}>
                  Return to Bot
                </AppButton>
              ) : (
                <AppButton type="button" onClick={() => setScreenMode(null)}>
                  Close
                </AppButton>
              )}
            </section>
          )}
          {workspace === "model" && (
            <section className="messages memory-view">
              <h2>Model settings · {bots.find((bot) => bot.id === botId)?.name}</h2>
              <div className="form-field">
                <span>Primary provider</span>
                <AppSelect
                  aria-label="Primary provider"
                  value={inferenceProviderId}
                  onChange={(event) => setInferenceProviderId(event.target.value)}
                >
                  <option value="">Account default</option>
                  {inferenceProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </AppSelect>
              </div>
              <label htmlFor="agentos-control-10">
                Model override (optional)
                <TextField.Root
                  id="agentos-control-10"
                  value={inferenceModel}
                  onChange={(event) => setInferenceModel(event.target.value)}
                  placeholder="Use provider default"
                  maxLength={200}
                  className="app-field"
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
                <AppButton
                  type="button"
                  className="primary"
                  onClick={() => void saveInferenceSettings()}
                >
                  Save model settings
                </AppButton>
                <AppButton type="button" onClick={() => showWorkspace("chat")}>
                  Back to chat
                </AppButton>
              </div>
            </section>
          )}
          {workspace === "subagents" ? (
            <section className="messages memory-view">
              <div className="memory-toolbar">
                <div>
                  <h2>Subagents</h2>
                  <p className="empty-note">Background tasks started by your agents.</p>
                </div>
                <div>
                  <AppButton type="button" onClick={() => void loadSubagents(false)}>
                    Refresh
                  </AppButton>
                  <AppButton type="button" onClick={() => showWorkspace("chat")}>
                    Back to chat
                  </AppButton>
                </div>
              </div>
              {!subagentItems.length && (
                <p className="empty-note">No background tasks have been started.</p>
              )}
              {subagentItems.map((item) => {
                const active = item.status === "queued" || item.status === "running";
                return (
                  <article className="memory-entry subagent-entry" key={item.id}>
                    <div className="memory-toolbar">
                      <div>
                        <span className={`status-pill status-${item.status}`}>{item.status}</span>
                        <small>Started {new Date(item.createdAt).toLocaleString()}</small>
                      </div>
                      <small>
                        {item.lastProgressAt
                          ? `Progress ${new Date(item.lastProgressAt).toLocaleString()}`
                          : "Waiting for its first step"}
                      </small>
                    </div>
                    <h3>Task</h3>
                    <p>{item.taskDescription}</p>
                    <small>
                      Access: {subagentToolLabels(item.allowedTools).join(" · ") || "No tools"}
                    </small>
                    {item.stallCount > 0 && (
                      <p className="empty-note">
                        {item.stallCount} stall {item.stallCount === 1 ? "event" : "events"}
                        {item.stallEvents.at(-1)?.reason
                          ? ` · ${item.stallEvents.at(-1)?.reason}`
                          : ""}
                      </p>
                    )}
                    {item.result && (
                      <details>
                        <summary>Result</summary>
                        <pre className="subagent-result">{item.result}</pre>
                      </details>
                    )}
                    {item.usage && (
                      <small>
                        Tokens: {item.usage.totalTokens.toLocaleString()} total ·{" "}
                        {item.usage.promptTokens.toLocaleString()} prompt ·{" "}
                        {item.usage.completionTokens.toLocaleString()} completion
                      </small>
                    )}
                    {active && (
                      <>
                        <form
                          className="subagent-steer-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void steerSubagent(item);
                          }}
                        >
                          <label htmlFor={`subagent-steer-${item.id}`}>Send guidance</label>
                          <TextArea
                            id={`subagent-steer-${item.id}`}
                            value={subagentSteering[item.id] ?? ""}
                            onChange={(event) =>
                              setSubagentSteering((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                            maxLength={2000}
                            rows={2}
                            placeholder="Add context or redirect the task"
                            className="app-textarea"
                          />
                          <div className="memory-actions">
                            <AppButton type="submit" disabled={!subagentSteering[item.id]?.trim()}>
                              Send guidance
                            </AppButton>
                            <AppButton
                              type="button"
                              className="deny"
                              onClick={() => void cancelSubagent(item)}
                            >
                              Cancel task
                            </AppButton>
                          </div>
                        </form>
                        {item.steeringEvents.length > 0 && (
                          <details>
                            <summary>Guidance history ({item.steeringEvents.length})</summary>
                            <ul>
                              {item.steeringEvents.map((event, index) => (
                                <li key={`${event.at}-${index}`}>
                                  {new Date(event.at).toLocaleString()} · {event.message}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    )}
                  </article>
                );
              })}
            </section>
          ) : workspace === "webhooks" ? (
            <section className="messages memory-view">
              <div className="memory-toolbar">
                <h2>Outbound webhooks</h2>
                <div>
                  <AppButton type="button" onClick={() => void loadWebhooks()}>
                    Refresh
                  </AppButton>
                  <AppButton type="button" onClick={() => setWebhookOpen(false)}>
                    Back to chat
                  </AppButton>
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
                  <AppButton type="button" onClick={() => setNewWebhookSecret("")}>
                    Done
                  </AppButton>
                </output>
              )}
              <form className="mcp-server-form" onSubmit={(event) => void createWebhook(event)}>
                <TextField.Root
                  aria-label="Webhook HTTPS URL"
                  type="url"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder="https://example.com/agentos-events"
                  required
                  className="app-field"
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
                <AppButton type="submit" disabled={!token || webhookEvents.length === 0}>
                  Create webhook
                </AppButton>
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
                  <AppButton type="button" onClick={() => void removeWebhook(subscription)}>
                    Delete subscription
                  </AppButton>
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
                    {delivery.lastStatusCode
                      ? `HTTP ${delivery.lastStatusCode}`
                      : "No HTTP response"}
                    {delivery.lastError ? ` · ${delivery.lastError}` : ""}
                  </p>
                  {delivery.status === "failed" && (
                    <AppButton type="button" onClick={() => void retryWebhookDelivery(delivery)}>
                      Retry delivery
                    </AppButton>
                  )}
                </article>
              ))}
            </section>
          ) : workspace === "connectors" ? (
            <section className="messages memory-view">
              <div className="memory-toolbar">
                <h2>Connectors</h2>
                <div>
                  <AppButton type="button" onClick={() => void loadConnectors()}>
                    Refresh
                  </AppButton>
                  <AppButton type="button" onClick={() => setConnectorOpen(false)}>
                    Back to chat
                  </AppButton>
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
                      className={`memory-entry connector-card connector-card--${card.id} ${connected ? "is-on" : ""}`}
                      key={card.id}
                    >
                      <div className="connector-card-head">
                        <ConnectorBrandIcon service={card.id} size={28} title={card.label} />
                        <div>
                          <strong>{card.label}</strong>
                          <small>{connected ? "Connected" : "Not connected"}</small>
                        </div>
                      </div>
                      {card.oauth === "microsoft" && (
                        <p>OneDrive, Outlook, Teams, and SharePoint share one Microsoft sign-in.</p>
                      )}
                      <div className="memory-actions">
                        {connected ? (
                          <AppButton
                            type="button"
                            onClick={() => void disconnectService(card.oauth)}
                          >
                            Disconnect
                          </AppButton>
                        ) : (
                          <AppButton type="button" onClick={() => void connectService(card.oauth)}>
                            Connect
                          </AppButton>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {connectorItems.map((connector) => (
                <article className="memory-entry connector-connected-row" key={connector.service}>
                  <div className="connector-card-head">
                    <ConnectorBrandIcon service={connector.service} size={24} />
                    <div>
                      <strong>{connector.service}</strong>
                      <small>Connected {new Date(connector.connectedAt).toLocaleString()}</small>
                    </div>
                  </div>
                  <p>Scopes: {connector.scopes.join(", ") || "provider defaults"}</p>
                  <div className="memory-actions">
                    <AppButton
                      type="button"
                      onClick={() => void disconnectService(connector.service)}
                    >
                      Disconnect
                    </AppButton>
                  </div>
                </article>
              ))}
              <h3>MCP servers</h3>
              <p className="empty-note">
                Connect an HTTPS MCP endpoint with a public hostname. API keys are encrypted before
                storage.
              </p>
              <form className="mcp-server-form" onSubmit={(event) => void addMcpServer(event)}>
                <TextField.Root
                  aria-label="MCP server name"
                  value={mcpName}
                  onChange={(event) => setMcpName(event.target.value)}
                  placeholder="Server name"
                  required
                  maxLength={120}
                  className="app-field"
                />
                <TextField.Root
                  aria-label="MCP server URL"
                  type="url"
                  value={mcpUrl}
                  onChange={(event) => setMcpUrl(event.target.value)}
                  placeholder="https://mcp.example.com"
                  required
                  className="app-field"
                />
                <TextField.Root
                  aria-label="MCP API key"
                  type="password"
                  autoComplete="new-password"
                  value={mcpApiKey}
                  onChange={(event) => setMcpApiKey(event.target.value)}
                  placeholder="Bearer API key (optional)"
                  className="app-field"
                />
                <AppButton type="submit" disabled={!token}>
                  Add MCP server
                </AppButton>
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
                  {server.lastError && <output>{server.lastError}</output>}
                  <p>{server.cachedTools?.length ?? 0} discovered tools</p>
                  <div className="memory-actions">
                    <AppButton type="button" onClick={() => void removeMcpServer(server)}>
                      Remove
                    </AppButton>
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
                  <AppButton type="button" onClick={() => void toggleRecording()} disabled={!botId}>
                    {recording ? "Stop recording" : "Record browser task"}
                  </AppButton>
                  <AppButton type="button" className="primary" onClick={openSkillCreate}>
                    New skill
                  </AppButton>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <Button type="button" variant="ghost" aria-label="Create a routine">
                        New routine
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={6}
                      className="routine-menu-content"
                    >
                      <DropdownMenu.Item
                        disabled={!botId || !skillItems.length}
                        onSelect={() => openRoutineCreate("cron")}
                      >
                        On a schedule
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={!botId || !skillItems.length}
                        onSelect={() => openRoutineCreate("webhook")}
                      >
                        From a webhook
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={
                          !botId ||
                          !skillItems.length ||
                          bots.filter((bot) => bot.id !== botId).length === 0
                        }
                        onSelect={() => openRoutineCreate("inter_bot_message")}
                      >
                        When another bot messages
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={!botId || !skillItems.length}
                        onSelect={() => openRoutineCreate("file_change")}
                      >
                        When a file changes
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={!botId || !skillItems.length}
                        onSelect={() => beginConnectorRoutine()}
                      >
                        When a Gmail or Calendar event arrives
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                  <AppButton type="button" onClick={() => showWorkspace("chat")}>
                    Back to chat
                  </AppButton>
                </div>
              </div>
              {routineWebhookSetup && (
                <output className="routine-webhook-setup">
                  <strong>Save this webhook secret now</strong>
                  <p>AgentOS stores only its hash, so it cannot be shown again.</p>
                  <code>POST {routineWebhookSetup.url}</code>
                  <code>X-Routine-Secret: {routineWebhookSetup.secret}</code>
                  <AppButton type="button" onClick={() => setRoutineWebhookSetup(null)}>
                    Done
                  </AppButton>
                </output>
              )}
              {newConnectorRoutineOpen && (
                <form
                  className="skill-editor"
                  onSubmit={(event) => void saveConnectorRoutine(event)}
                >
                  <h3>New connector routine</h3>
                  <label htmlFor="agentos-control-11">
                    Routine name
                    <TextField.Root
                      id="agentos-control-11"
                      value={routineDraftName}
                      onChange={(event) => setRoutineDraftName(event.target.value)}
                      maxLength={120}
                      required
                      className="app-field"
                    />
                  </label>
                  <div className="form-field">
                    <span>Bot</span>
                    <AppSelect
                      aria-label="Bot"
                      value={routineDraftBotId}
                      onChange={(event) => {
                        const nextBotId = event.target.value;
                        setRoutineDraftBotId(nextBotId);
                        const compatibleSkills = skillItems.filter(
                          (skill) => !skill.ownerBotId || skill.ownerBotId === nextBotId,
                        );
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
                    </AppSelect>
                  </div>
                  <div className="form-field">
                    <span>Skill</span>
                    <AppSelect
                      aria-label="Skill"
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
                    </AppSelect>
                  </div>
                  <div className="form-field form-field--connector">
                    <span>Connector</span>
                    <div className="connector-select-row">
                      <AppSelect
                        aria-label="Connector"
                        value={routineDraftConnectorService}
                        onChange={(event) =>
                          setRoutineDraftConnectorService(
                            event.target.value as "gmail" | "google-calendar",
                          )
                        }
                      >
                        <option value="gmail">Gmail</option>
                        <option value="google-calendar">Google Calendar</option>
                      </AppSelect>
                      <ConnectorBrandIcon
                        service={routineDraftConnectorService}
                        size={20}
                        className="connector-brand-icon connector-brand-icon--inline"
                      />
                    </div>
                  </div>
                  {routineDraftConnectorService === "gmail" && (
                    <label htmlFor="agentos-control-15">
                      Sender email (optional)
                      <TextField.Root
                        id="agentos-control-15"
                        type="email"
                        value={routineDraftConnectorSender}
                        onChange={(event) => setRoutineDraftConnectorSender(event.target.value)}
                        maxLength={200}
                        placeholder="name@example.com"
                        className="app-field"
                      />
                    </label>
                  )}
                  <label htmlFor="agentos-control-16">
                    {routineDraftConnectorService === "gmail"
                      ? "Subject contains (optional)"
                      : "Event title contains"}
                    <TextField.Root
                      id="agentos-control-16"
                      value={routineDraftConnectorSubject}
                      onChange={(event) => setRoutineDraftConnectorSubject(event.target.value)}
                      maxLength={200}
                      placeholder="Project update"
                      className="app-field"
                    />
                  </label>
                  {routineDraftConnectorService === "gmail" ? (
                    <label htmlFor="agentos-control-17">
                      Gmail search query (optional)
                      <TextField.Root
                        id="agentos-control-17"
                        value={routineDraftConnectorQuery}
                        onChange={(event) => setRoutineDraftConnectorQuery(event.target.value)}
                        maxLength={200}
                        placeholder="has:attachment"
                        className="app-field"
                      />
                    </label>
                  ) : (
                    <label htmlFor="agentos-control-18">
                      Calendar ID
                      <TextField.Root
                        id="agentos-control-18"
                        value={routineDraftCalendarId}
                        onChange={(event) => setRoutineDraftCalendarId(event.target.value)}
                        maxLength={200}
                        placeholder="primary"
                        className="app-field"
                      />
                    </label>
                  )}
                  <div className="form-field">
                    <span>When a run fails</span>
                    <AppSelect
                      aria-label="When a run fails"
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
                    </AppSelect>
                  </div>
                  <p>
                    Connect the selected Google service first. The initial poll records a baseline;
                    only new matching events trigger runs.
                  </p>
                  <div className="memory-actions">
                    <AppButton type="submit" className="primary">
                      Create routine
                    </AppButton>
                    <AppButton type="button" onClick={() => setNewConnectorRoutineOpen(false)}>
                      Cancel
                    </AppButton>
                  </div>
                </form>
              )}
              {taughtDraft && (
                <form
                  className="skill-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveTaughtDraft();
                  }}
                >
                  <strong>Review skill draft</strong>
                  <label htmlFor="agentos-control-20">
                    Name
                    <TextField.Root
                      id="agentos-control-20"
                      value={taughtDraft.name}
                      onChange={(event) =>
                        setTaughtDraft({ ...taughtDraft, name: event.target.value })
                      }
                      maxLength={120}
                      className="app-field"
                    />
                  </label>
                  <label htmlFor="agentos-control-21">
                    Description
                    <TextArea
                      id="agentos-control-21"
                      value={taughtDraft.description}
                      onChange={(event) =>
                        setTaughtDraft({ ...taughtDraft, description: event.target.value })
                      }
                      rows={2}
                      maxLength={2000}
                      className="app-textarea"
                    />
                  </label>
                  {taughtDraft.steps.map((step, index) => (
                    <div className="skill-step-editor" key={step.id}>
                      <label htmlFor="agentos-control-22">
                        Step {index + 1}
                        <TextArea
                          id="agentos-control-22"
                          value={step.instruction}
                          onChange={(event) => {
                            const steps = taughtDraft.steps.slice();
                            const current = steps[index];
                            if (!current) return;
                            steps[index] = { ...current, instruction: event.target.value };
                            setTaughtDraft({ ...taughtDraft, steps });
                          }}
                          rows={2}
                          maxLength={4000}
                          className="app-textarea"
                        />
                      </label>
                      <label className="skill-approval-toggle">
                        <input
                          type="checkbox"
                          checked={step.approvalRequired}
                          onChange={(event) => {
                            const steps = taughtDraft.steps.slice();
                            const current = steps[index];
                            if (!current) return;
                            steps[index] = { ...current, approvalRequired: event.target.checked };
                            setTaughtDraft({ ...taughtDraft, steps });
                          }}
                        />
                        Require approval before this step
                      </label>
                      <AppButton
                        type="button"
                        onClick={() =>
                          setTaughtDraft({
                            ...taughtDraft,
                            steps: taughtDraft.steps.filter((_, stepIndex) => stepIndex !== index),
                          })
                        }
                        disabled={taughtDraft.steps.length < 2}
                      >
                        Remove step
                      </AppButton>
                    </div>
                  ))}
                  <div className="memory-actions">
                    <AppButton
                      type="button"
                      onClick={() =>
                        setTaughtDraft({
                          ...taughtDraft,
                          steps: [
                            ...taughtDraft.steps,
                            {
                              id: crypto.randomUUID(),
                              instruction: "",
                              approvalRequired: false,
                              onError: "stop",
                              maxAttempts: 3,
                              customPrompt: "",
                            },
                          ],
                        })
                      }
                      disabled={taughtDraft.steps.length >= 20}
                    >
                      Add step
                    </AppButton>
                    <AppButton type="submit">Save skill</AppButton>
                    <AppButton type="button" onClick={() => setTaughtDraft(null)}>
                      Discard draft
                    </AppButton>
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
                      <label htmlFor="agentos-control-23">
                        Name
                        <TextField.Root
                          id="agentos-control-23"
                          value={skillDraftName}
                          onChange={(event) => setSkillDraftName(event.target.value)}
                          maxLength={120}
                          className="app-field"
                        />
                      </label>
                      <label htmlFor="agentos-control-24">
                        Description
                        <TextArea
                          id="agentos-control-24"
                          value={skillDraftDescription}
                          onChange={(event) => setSkillDraftDescription(event.target.value)}
                          rows={2}
                          className="app-textarea"
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
                          <label htmlFor="agentos-control-25">
                            Step {index + 1}
                            <TextArea
                              id="agentos-control-25"
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
                              className="app-textarea"
                            />
                          </label>
                          <div>
                            <div className="form-field">
                              <span>Error handling</span>
                              <AppSelect
                                aria-label="Error handling"
                                value={step.onError}
                                onChange={(event) =>
                                  setSkillDraftSteps((previous) =>
                                    previous.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                            ...item,
                                            onError: event.target
                                              .value as SkillStepDraft["onError"],
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
                              </AppSelect>
                            </div>
                            {step.onError === "custom_prompt" && (
                              <label htmlFor="agentos-control-27">
                                Recovery prompt
                                <TextArea
                                  id="agentos-control-27"
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
                                  className="app-textarea"
                                />
                              </label>
                            )}
                            {(step.onError === "retry" || step.onError === "custom_prompt") && (
                              <label htmlFor="agentos-control-28">
                                Maximum failed actions (1–10)
                                <TextField.Root
                                  id="agentos-control-28"
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
                                  className="app-field"
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
                          <AppButton
                            type="button"
                            onClick={() =>
                              setSkillDraftSteps((previous) =>
                                previous.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                            disabled={skillDraftSteps.length < 2}
                          >
                            Remove step
                          </AppButton>
                        </div>
                      ))}
                      <div className="memory-actions">
                        <AppButton
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
                        </AppButton>
                        <AppButton type="button" onClick={() => void saveSkill()}>
                          Save version
                        </AppButton>
                        <AppButton type="button" onClick={() => setEditingSkillId("")}>
                          Cancel
                        </AppButton>
                      </div>
                    </div>
                  )}
                  <div className="memory-actions">
                    <AppButton
                      type="button"
                      onClick={() =>
                        editingSkillId === skill.id ? setEditingSkillId("") : editSkill(skill)
                      }
                    >
                      {editingSkillId === skill.id ? "Close editor" : "Edit"}
                    </AppButton>
                    <AppButton type="button" onClick={() => void testSkill(skill)}>
                      Test skill
                    </AppButton>
                    {skillTests[skill.id] && (
                      <AppButton type="button" onClick={() => void refreshSkillTest(skill)}>
                        Test {skillTests[skill.id]?.status}
                      </AppButton>
                    )}
                    <AppButton type="button" onClick={() => void deleteSkill(skill)}>
                      Delete
                    </AppButton>
                    <AppSelect
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
                    </AppSelect>
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
                      <label htmlFor="agentos-control-29">
                        Routine name
                        <TextField.Root
                          id="agentos-control-29"
                          value={routineDraftName}
                          onChange={(event) => setRoutineDraftName(event.target.value)}
                          maxLength={120}
                          className="app-field"
                        />
                      </label>
                      <div className="form-field">
                        <span>Bot</span>
                        <AppSelect
                          aria-label="Bot"
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
                        </AppSelect>
                      </div>
                      <div className="form-field">
                        <span>Skill</span>
                        <AppSelect
                          aria-label="Skill"
                          value={routineDraftSkillId}
                          onChange={(event) => setRoutineDraftSkillId(event.target.value)}
                        >
                          {skillItems
                            .filter(
                              (skill) =>
                                !skill.ownerBotId || skill.ownerBotId === routineDraftBotId,
                            )
                            .map((skill) => (
                              <option key={skill.id} value={skill.id}>
                                {skill.name}
                              </option>
                            ))}
                        </AppSelect>
                      </div>
                      {routine.trigger.type === "cron" && (
                        <>
                          <label htmlFor="agentos-control-32">
                            Five-field cron schedule
                            <TextField.Root
                              id="agentos-control-32"
                              value={routineDraftSchedule}
                              onChange={(event) => setRoutineDraftSchedule(event.target.value)}
                              placeholder="0 9 * * *"
                              className="app-field"
                            />
                          </label>
                          <p>{cronPreview(routineDraftSchedule)}</p>
                        </>
                      )}
                      {routine.trigger.type === "file_change" && (
                        <label htmlFor="agentos-control-33">
                          Workspace path
                          <TextField.Root
                            id="agentos-control-33"
                            value={routineDraftPath}
                            onChange={(event) => setRoutineDraftPath(event.target.value)}
                            placeholder="/home/agent"
                            className="app-field"
                          />
                        </label>
                      )}
                      {routine.trigger.type === "connector_event" && (
                        <>
                          <div className="form-field form-field--connector">
                            <span>Connector</span>
                            <div className="connector-select-row">
                              <AppSelect
                                aria-label="Connector"
                                value={routineDraftConnectorService}
                                onChange={(event) =>
                                  setRoutineDraftConnectorService(
                                    event.target.value as "gmail" | "google-calendar",
                                  )
                                }
                              >
                                <option value="gmail">Gmail</option>
                                <option value="google-calendar">Google Calendar</option>
                              </AppSelect>
                              <ConnectorBrandIcon
                                service={routineDraftConnectorService}
                                size={20}
                                className="connector-brand-icon connector-brand-icon--inline"
                              />
                            </div>
                          </div>
                          {routineDraftConnectorService === "gmail" && (
                            <label htmlFor="agentos-control-35">
                              Sender email (optional)
                              <TextField.Root
                                id="agentos-control-35"
                                type="email"
                                value={routineDraftConnectorSender}
                                onChange={(event) =>
                                  setRoutineDraftConnectorSender(event.target.value)
                                }
                                maxLength={200}
                                placeholder="name@example.com"
                                className="app-field"
                              />
                            </label>
                          )}
                          <label htmlFor="agentos-control-36">
                            {routineDraftConnectorService === "gmail"
                              ? "Subject contains (optional)"
                              : "Event title contains"}
                            <TextField.Root
                              id="agentos-control-36"
                              value={routineDraftConnectorSubject}
                              onChange={(event) =>
                                setRoutineDraftConnectorSubject(event.target.value)
                              }
                              maxLength={200}
                              placeholder="Project update"
                              className="app-field"
                            />
                          </label>
                          {routineDraftConnectorService === "gmail" ? (
                            <label htmlFor="agentos-control-37">
                              Gmail search query (optional)
                              <TextField.Root
                                id="agentos-control-37"
                                value={routineDraftConnectorQuery}
                                onChange={(event) =>
                                  setRoutineDraftConnectorQuery(event.target.value)
                                }
                                maxLength={200}
                                placeholder="has:attachment"
                                className="app-field"
                              />
                            </label>
                          ) : (
                            <label htmlFor="agentos-control-38">
                              Calendar ID
                              <TextField.Root
                                id="agentos-control-38"
                                value={routineDraftCalendarId}
                                onChange={(event) => setRoutineDraftCalendarId(event.target.value)}
                                maxLength={200}
                                placeholder="primary"
                                className="app-field"
                              />
                            </label>
                          )}
                          <p>Choose a filter so the routine only runs for matching events.</p>
                        </>
                      )}
                      <div className="form-field">
                        <span>When a run fails</span>
                        <AppSelect
                          aria-label="When a run fails"
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
                        </AppSelect>
                      </div>
                      {routine.trigger.type === "inter_bot_message" && (
                        <div className="form-field">
                          <span>Sender bot filter</span>
                          <AppSelect
                            aria-label="Sender bot filter"
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
                          </AppSelect>
                        </div>
                      )}
                      <div className="memory-actions">
                        <AppButton type="button" onClick={() => void saveRoutineEdit(routine)}>
                          Save routine
                        </AppButton>
                        <AppButton type="button" onClick={() => setEditingRoutineId("")}>
                          Cancel
                        </AppButton>
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
                    <AppButton type="button" onClick={() => editRoutine(routine)}>
                      Edit
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => void updateRoutine(routine, { test: true })}
                    >
                      Test run
                    </AppButton>
                    <AppButton type="button" onClick={() => void loadRoutineHistory(routine)}>
                      History
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => void updateRoutine(routine, { enabled: !routine.enabled })}
                    >
                      {routine.enabled ? "Pause" : "Resume"}
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => void updateRoutine(routine, { delete: true })}
                    >
                      Delete
                    </AppButton>
                  </div>
                </article>
              ))}
            </section>
          ) : workspace === "memory" ? (
            <section className="messages memory-view">
              <div className="memory-toolbar">
                <h2>Memory</h2>
                <div>
                  <AppButton type="button" onClick={() => void loadMemories()}>
                    Refresh
                  </AppButton>
                  <AppButton type="button" onClick={() => void exportMemories()}>
                    Export JSON
                  </AppButton>
                  <AppButton type="button" onClick={() => showWorkspace("chat")}>
                    Back to chat
                  </AppButton>
                </div>
              </div>
              {!!memoryReviewSuggestions.length && (
                <section aria-labelledby="memory-review-heading">
                  <h3 id="memory-review-heading">Suggested memory changes</h3>
                  <p className="empty-note">
                    Review each change. Updates and deletions are applied only after you accept.
                  </p>
                  {memoryReviewSuggestions.map((suggestion) => (
                    <article className="memory-entry" key={suggestion.id}>
                      <small>
                        {suggestion.action === "delete"
                          ? "Possible removal"
                          : "Possible correction"}{" "}
                        · {new Date(suggestion.createdAt).toLocaleString()}
                      </small>
                      <p>
                        <strong>Saved memory</strong>
                        <br />
                        {suggestion.existingContent}
                      </p>
                      {suggestion.currentContent !== suggestion.existingContent && (
                        <p className="empty-note">
                          This memory changed after the suggestion was created. Dismiss it and
                          review the current memory.
                        </p>
                      )}
                      {suggestion.action === "update" && suggestion.proposedContent && (
                        <p>
                          <strong>Suggested replacement</strong>
                          <br />
                          {suggestion.proposedContent}
                        </p>
                      )}
                      {suggestion.action === "delete" && (
                        <p>
                          <strong>Why it was suggested</strong>
                          <br />
                          {suggestion.reason ||
                            "The latest conversation may indicate this fact is no longer valid."}
                        </p>
                      )}
                      <div className="memory-actions">
                        <AppButton
                          type="button"
                          disabled={suggestion.currentContent !== suggestion.existingContent}
                          onClick={() => void resolveMemoryReview(suggestion, "accept")}
                        >
                          {suggestion.action === "delete" ? "Delete memory" : "Accept update"}
                        </AppButton>
                        <AppButton
                          type="button"
                          onClick={() => void resolveMemoryReview(suggestion, "reject")}
                        >
                          Dismiss
                        </AppButton>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {!memoryEntries.length && (
                <p className="empty-note">No saved memories for this bot.</p>
              )}
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
                    <AppButton type="button" onClick={() => void loadMemoryEvidence(memory)}>
                      {memoryEvidence[memory.id] ? "Hide evidence" : "Evidence"}
                    </AppButton>
                    <AppButton type="button" onClick={() => void editMemory(memory)}>
                      Edit
                    </AppButton>
                    <AppButton type="button" onClick={() => void deleteMemory(memory)}>
                      Delete
                    </AppButton>
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
            <div className="messages" ref={scrollRef} onScroll={handleConversationScroll}>
              {!items.length && (
                <div className="welcome">
                  <div className="welcome-icon">
                    <Sparkles className="glyph" aria-hidden="true" />
                  </div>
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
                      <AppButton
                        key={suggestion}
                        type="button"
                        disabled={!botId}
                        onClick={() => {
                          setDraft(suggestion);
                          composerRef.current?.focus();
                        }}
                      >
                        {suggestion}
                      </AppButton>
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
                          <AppButton type="button" onClick={() => void decide(item, "allow_once")}>
                            Allow once
                          </AppButton>
                          <AppButton
                            type="button"
                            onClick={() => void decide(item, "always_allow")}
                          >
                            Always allow
                          </AppButton>
                          <AppButton
                            type="button"
                            className="deny"
                            onClick={() => void decide(item, "deny")}
                          >
                            Deny
                          </AppButton>
                        </div>
                      )}
                    </details>
                  ) : (
                    <div className="message-bubble">
                      <div className="message-label">
                        {item.role === "user" ? "You" : (selectedBot?.name ?? "Agent")}
                        {item.role === "assistant" && (
                          <AppButton
                            type="button"
                            className="copy-button"
                            onClick={() => void navigator.clipboard.writeText(item.content)}
                          >
                            <Copy size={12} aria-hidden="true" />
                            Copy
                          </AppButton>
                        )}
                      </div>
                      <div
                        className={`message-content${item.role === "assistant" ? " markdown-content" : ""}`}
                      >
                        {item.role === "assistant" ? (
                          <React.Suspense
                            fallback={<span className="markdown-loading">Formatting reply…</span>}
                          >
                            <AssistantMarkdown
                              content={item.content}
                              onError={(err) =>
                                setError(err instanceof Error ? err.message : String(err))
                              }
                            />
                          </React.Suspense>
                        ) : (
                          item.content
                        )}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : null}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <AppButton type="button" onClick={() => setError("")} aria-label="Dismiss">
                ×
              </AppButton>
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
                      <AppButton
                        type="button"
                        onClick={() =>
                          setPendingFiles((current) =>
                            current.filter((item) => item.id !== file.id),
                          )
                        }
                      >
                        ×
                      </AppButton>
                    </span>
                  ))}
                </div>
              )}
              <TextArea
                ref={composerRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  const node = event.target;
                  node.style.height = "0px";
                  node.style.height = `${Math.min(180, node.scrollHeight)}px`;
                }}
                placeholder={
                  botId
                    ? `Message ${selectedBot?.name ?? "your agent"}`
                    : "Connect and choose a bot"
                }
                disabled={!botId}
                rows={1}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                className="app-textarea"
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
                  <Button
                    type="button"
                    variant="ghost"
                    className="icon-button"
                    title="Attach files"
                    disabled={!botId}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="glyph" aria-hidden="true" />
                  </Button>
                  <span>
                    <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
                    {dragOver ? " · Drop to attach" : ""}
                  </span>
                </div>
                <Button
                  type="submit"
                  variant="solid"
                  className="primary"
                  disabled={sendingPrompt || !botId || (!draft.trim() && pendingFiles.length === 0)}
                  aria-busy={sendingPrompt}
                >
                  {sendingPrompt ? "Sending…" : "Send"}
                  <ArrowRight className="glyph" aria-hidden="true" />
                </Button>
              </div>
            </form>
          )}
          <AlertDialog.Root
            open={confirmation !== null}
            onOpenChange={(open) => {
              if (!open && confirmation) resolveConfirmation(false);
            }}
          >
            {confirmation && (
              <AlertDialog.Content maxWidth="440px">
                <AlertDialog.Title>{confirmation.title}</AlertDialog.Title>
                <AlertDialog.Description>{confirmation.description}</AlertDialog.Description>
                <div className="memory-actions">
                  <AlertDialog.Cancel>
                    <AppButton type="button">Cancel</AppButton>
                  </AlertDialog.Cancel>
                  <AppButton
                    type="button"
                    className={confirmation.destructive ? "danger" : "primary"}
                    variant="solid"
                    color={confirmation.destructive ? "red" : undefined}
                    onClick={() => resolveConfirmation(true)}
                  >
                    {confirmation.confirmLabel}
                  </AppButton>
                </div>
              </AlertDialog.Content>
            )}
          </AlertDialog.Root>
          <Dialog.Root
            open={memoryEditTarget !== null}
            onOpenChange={(open) => {
              if (!open) setMemoryEditTarget(null);
            }}
          >
            <Dialog.Content maxWidth="540px">
              <Dialog.Title>Edit memory</Dialog.Title>
              <Dialog.Description>
                Update the fact the agent uses as context. This changes the saved memory
                immediately.
              </Dialog.Description>
              <form className="skill-editor" onSubmit={(event) => void saveMemoryEdit(event)}>
                <label htmlFor="agentos-control-41">
                  Memory
                  <TextArea
                    id="agentos-control-41"
                    value={memoryEditDraft}
                    onChange={(event) => setMemoryEditDraft(event.target.value)}
                    rows={6}
                    maxLength={4000}
                    required
                    className="app-textarea"
                  />
                </label>
                <div className="memory-actions">
                  <Dialog.Close>
                    <AppButton type="button">Cancel</AppButton>
                  </Dialog.Close>
                  <AppButton
                    type="submit"
                    className="primary"
                    disabled={
                      !memoryEditDraft.trim() ||
                      memoryEditDraft.trim() === memoryEditTarget?.content
                    }
                  >
                    Save memory
                  </AppButton>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Root>
          <Dialog.Root open={skillCreateOpen} onOpenChange={setSkillCreateOpen}>
            <Dialog.Content maxWidth="540px">
              <Dialog.Title>New skill</Dialog.Title>
              <Dialog.Description>
                Draft steps from a description or enter them manually. Review and approve any
                generated checkpoints before saving.
              </Dialog.Description>
              <Tabs.Root defaultValue="draft">
                <Tabs.List aria-label="Skill creation method">
                  <Tabs.Trigger value="draft">Draft with AI</Tabs.Trigger>
                  <Tabs.Trigger value="manual">Create manually</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="draft">
                  <form
                    className="skill-editor"
                    onSubmit={(event) => void draftSkillFromDescription(event)}
                  >
                    <label htmlFor="agentos-control-42">
                      Task description
                      <TextArea
                        id="agentos-control-42"
                        value={skillCreateDescription}
                        onChange={(event) => setSkillCreateDescription(event.target.value)}
                        rows={6}
                        maxLength={6000}
                        required
                        placeholder="Describe the task and what a successful result should look like."
                        className="app-textarea"
                      />
                      <small>{skillCreateDescription.length}/6000</small>
                    </label>
                    <div className="memory-actions">
                      <Dialog.Close>
                        <AppButton type="button" disabled={skillDrafting}>
                          Cancel
                        </AppButton>
                      </Dialog.Close>
                      <AppButton
                        type="submit"
                        className="primary"
                        disabled={skillDrafting || !skillCreateDescription.trim()}
                      >
                        {skillDrafting ? "Drafting…" : "Draft steps"}
                      </AppButton>
                    </div>
                  </form>
                </Tabs.Content>
                <Tabs.Content value="manual">
                  <form
                    className="skill-editor"
                    onSubmit={(event) => void createSkillManually(event)}
                  >
                    <label htmlFor="agentos-control-43">
                      Name
                      <TextField.Root
                        id="agentos-control-43"
                        value={skillManualName}
                        onChange={(event) => setSkillManualName(event.target.value)}
                        maxLength={120}
                        required
                        className="app-field"
                      />
                    </label>
                    <label htmlFor="agentos-control-44">
                      Instructions
                      <TextArea
                        id="agentos-control-44"
                        value={skillManualInstructions}
                        onChange={(event) => setSkillManualInstructions(event.target.value)}
                        rows={7}
                        required
                        placeholder={"Open the project dashboard\nSummarize the latest activity"}
                        className="app-textarea"
                      />
                    </label>
                    <div className="memory-actions">
                      <Dialog.Close>
                        <AppButton type="button">Cancel</AppButton>
                      </Dialog.Close>
                      <AppButton type="submit" className="primary">
                        Create skill
                      </AppButton>
                    </div>
                  </form>
                </Tabs.Content>
              </Tabs.Root>
            </Dialog.Content>
          </Dialog.Root>
          <Dialog.Root open={routineCreateOpen} onOpenChange={setRoutineCreateOpen}>
            <Dialog.Content maxWidth="560px">
              <Dialog.Title>New routine</Dialog.Title>
              <Dialog.Description>
                This routine runs a skill on the selected bot when its trigger fires.
              </Dialog.Description>
              <form className="skill-editor" onSubmit={(event) => void createRoutine(event)}>
                <label htmlFor="agentos-control-45">
                  Name
                  <TextField.Root
                    id="agentos-control-45"
                    value={routineCreateName}
                    onChange={(event) => setRoutineCreateName(event.target.value)}
                    maxLength={120}
                    required
                    className="app-field"
                  />
                </label>
                <div className="form-field">
                  <span>Skill</span>
                  <AppSelect
                    aria-label="Skill"
                    value={routineCreateSkillId}
                    onChange={(event) => setRoutineCreateSkillId(event.target.value)}
                    required
                  >
                    {skillItems
                      .filter((skill) => !skill.ownerBotId || skill.ownerBotId === botId)
                      .map((skill) => (
                        <option key={skill.id} value={skill.id}>
                          {skill.name}
                        </option>
                      ))}
                  </AppSelect>
                </div>
                {routineCreateType === "cron" && (
                  <label htmlFor="agentos-control-47">
                    Schedule (minute hour day month weekday)
                    <TextField.Root
                      id="agentos-control-47"
                      value={routineCreateSchedule}
                      onChange={(event) => setRoutineCreateSchedule(event.target.value)}
                      placeholder="0 9 * * *"
                      required
                      className="app-field"
                    />
                  </label>
                )}
                {routineCreateType === "file_change" && (
                  <label htmlFor="agentos-control-48">
                    Workspace path to watch
                    <TextField.Root
                      id="agentos-control-48"
                      value={routineCreateFilePath}
                      onChange={(event) => setRoutineCreateFilePath(event.target.value)}
                      placeholder="/home/agent/project"
                      required
                      className="app-field"
                    />
                  </label>
                )}
                {routineCreateType === "inter_bot_message" && (
                  <div className="form-field">
                    <span>Sender bot</span>
                    <AppSelect
                      aria-label="Sender bot"
                      value={routineCreateSenderBotId}
                      onChange={(event) => setRoutineCreateSenderBotId(event.target.value)}
                    >
                      <option value="">Any bot</option>
                      {bots
                        .filter((bot) => bot.id !== botId && bot.role !== "subagent")
                        .map((bot) => (
                          <option key={bot.id} value={bot.id}>
                            {bot.name}
                          </option>
                        ))}
                    </AppSelect>
                  </div>
                )}
                {routineCreateType === "webhook" && (
                  <p>A one-time signing secret will be shown after the routine is created.</p>
                )}
                <div className="memory-actions">
                  <Dialog.Close>
                    <AppButton type="button">Cancel</AppButton>
                  </Dialog.Close>
                  <AppButton type="submit" className="primary">
                    Create routine
                  </AppButton>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Root>
        </ErrorBoundary>
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

function appendAssistantDelta(
  items: ChatItem[],
  pending: { runId: string; agentId?: string; text: string },
): ChatItem[] {
  const idx = items.findIndex((item) => item.role === "assistant" && item.runId === pending.runId);
  if (idx < 0) {
    return [
      ...items,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: pending.text,
        runId: pending.runId,
        agentId: pending.agentId,
      },
    ];
  }
  const next = items.slice();
  const current = next[idx];
  if (!current) return items;
  next[idx] = { ...current, content: current.content + pending.text };
  return next;
}

function activityLabel(toolName: string | undefined, params: unknown): string {
  const args =
    params && typeof params === "object"
      ? (params as { action?: unknown; query?: unknown; key?: unknown })
      : {};
  const query = typeof args.query === "string" ? args.query.slice(0, 40) : "";
  if (toolName === "Computer") {
    const action = typeof args.action === "string" ? args.action : "screenshot";
    if (action === "screenshot" || action === "find")
      return query ? `Looking for “${query}”` : "Looking at the screen";
    if (action === "click" || action === "double_click")
      return query ? `Clicking “${query}”` : "Clicking";
    if (action === "right_click") return "Right-clicking";
    if (action === "type") return "Typing";
    if (action === "key") return `Pressing ${typeof args.key === "string" ? args.key : "a key"}`;
    if (action === "scroll") return "Scrolling";
    if (action === "drag") return "Dragging";
    if (action === "move") return "Moving the pointer";
  }
  if (toolName === "BrowserClick") return query ? `Clicking “${query}”` : "Clicking";
  if (toolName === "BrowserType") return "Typing";
  if (toolName === "BrowserNavigate") return "Opening a page";
  if (toolName === "BrowserScreenshot") return "Looking at the screen";
  if (toolName === "BrowserScroll") return "Scrolling";
  return toolName ? `Using ${toolName}` : "Working";
}

function previewPayload(value: unknown): string {
  const text = JSON.stringify(value ?? {}, null, 2);
  return text.length > 800 ? `${text.slice(0, 800)}…` : text;
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
        from the repository root with <code>pnpm --filter @agentos/desktop electron</code>.
      </p>
    </div>
  );
}

function Root() {
  const key = clerkPublishableKey();
  if (!key) return <App />;
  return (
    <React.Suspense fallback={<div className="auth-loading">Loading secure sign-in…</div>}>
      <ClerkBoundary publishableKey={key}>{(clerk) => <App clerk={clerk} />}</ClerkBoundary>
    </React.Suspense>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root mount node is missing");
createRoot(rootElement).render(
  <React.StrictMode>
    <Theme appearance="dark" accentColor="teal" grayColor="sage" radius="medium">
      <ErrorBoundary fallbackTitle="AgentOS hit a display error">
        {typeof window.agentOS?.onFrame === "function" ? <Root /> : <DesktopRequired />}
      </ErrorBoundary>
    </Theme>
  </React.StrictMode>,
);
