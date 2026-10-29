import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

interface Bot {
  id: string;
  name: string;
  role: string;
  inferenceSettings?: { providerId?: string; model?: string };
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
    | { type: "inter_bot_message"; senderBotId?: string };
  lastTriggeredAt: string | null;
  nextRunAt?: string | null;
  cronTimezone?: string | null;
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
  const senderName = trigger.senderBotId
    ? (bots.find((bot) => bot.id === trigger.senderBotId)?.name ?? "selected bot")
    : "any bot";
  return `Inter-bot message from ${senderName}`;
}
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
interface Frame {
  type: string;
  agentId?: string;
  runId?: string;
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
  const [baseUrl, setBaseUrl] = useState("http://localhost:8787");
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
  const [connectorItems, setConnectorItems] = useState<ConnectorItem[]>([]);
  const [mcpItems, setMcpItems] = useState<McpServerItem[]>([]);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpApiKey, setMcpApiKey] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
      } else if (frame.type === "settled") {
        setActiveRun("");
      } else if (frame.type === "error") {
        setError(`${frame.code ?? "error"}: ${frame.message ?? "request failed"}`);
        setActiveRun("");
      }
    });
    const stopStatus = window.agentOS.onStatus(setStatus);
    return () => {
      stopFrame();
      stopStatus();
      void window.agentOS.disconnect();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the item list is the scroll trigger; the ref is stable.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [items]);

  async function connect() {
    setError("");
    try {
      await window.agentOS.connect(baseUrl, token);
      const roster = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/bots",
      })) as Bot[];
      setBots(roster);
      setBotId(roster[0]?.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createBot() {
    const name = window.prompt("Name for the new bot");
    if (!name?.trim()) return;
    try {
      await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/bots",
        method: "POST",
        body: { name },
      });
      const roster = (await window.agentOS.apiRequest({
        baseUrl,
        token,
        path: "/v1/bots",
      })) as Bot[];
      setBots(roster);
      setBotId(roster[roster.length - 1]?.id ?? "");
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
      setAutomationOpen(false);
      setWebhookOpen(false);
      setMemoryOpen(true);
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
      setInferenceProviderId(bot.inferenceSettings?.providerId ?? providers[0] ?? "");
      setInferenceModel(bot.inferenceSettings?.model ?? "");
      setAutomationOpen(false);
      setMemoryOpen(false);
      setConnectorOpen(false);
      setWebhookOpen(false);
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
      setError("Model settings saved. They apply to new runs.");
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
      setConnectorOpen(false);
      setMemoryOpen(false);
      setWebhookOpen(false);
      setAutomationOpen(true);
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

  async function createRoutine(triggerType: "cron" | "webhook" | "inter_bot_message" = "cron") {
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
              : {}),
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
      setAutomationOpen(false);
      setMemoryOpen(false);
      setWebhookOpen(false);
      setConnectorOpen(true);
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
      setAutomationOpen(false);
      setMemoryOpen(false);
      setConnectorOpen(false);
      setInferenceProviders([]);
      setWebhookOpen(true);
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

  async function connectService(service: "gmail" | "google-calendar" | "google-drive") {
    try {
      await window.agentOS.connectService(baseUrl, token, service);
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

  async function sendPrompt(event: React.FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || !botId) return;
    setItems((old) => [
      ...old,
      { id: crypto.randomUUID(), role: "user", content: prompt, agentId: botId },
    ]);
    setDraft("");
    setError("");
    try {
      await window.agentOS.send({
        type: "sendPrompt",
        agentId: botId,
        prompt,
        attachments: [],
        nonce: crypto.randomUUID(),
      });
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>AgentOS</span>
        </div>
        <div className="connection">
          <label>
            Gateway URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label>
            Bearer token
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="Paste bootstrap token"
            />
          </label>
          <button type="button" className="connect-button" onClick={() => void connect()}>
            Connect
          </button>
          <div className="connection-state">
            <i className={status === "connected" ? "online" : ""} />
            {status}
          </div>
        </div>
        <div className="roster-head">
          <span>BOTS</span>
          <button type="button" onClick={() => void createBot()} disabled={!token}>
            ＋
          </button>
        </div>
        <div className="roster">
          {bots.map((bot) => (
            <button
              type="button"
              key={bot.id}
              className={`bot-row ${bot.id === botId ? "selected" : ""}`}
              onClick={() => {
                setBotId(bot.id);
                setItems([]);
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
        </div>
        <div className="sidebar-footer">Local agent workspace</div>
      </aside>
      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <strong>{bots.find((b) => b.id === botId)?.name ?? "Choose a bot"}</strong>
            <span>Agent conversation</span>
          </div>
          {activeRun && (
            <button
              type="button"
              className="stop-button"
              onClick={() =>
                void window.agentOS.send({ type: "interrupt", agentId: botId, runId: activeRun })
              }
            >
              Stop run
            </button>
          )}
          <button
            type="button"
            className="stop-button"
            onClick={() => void loadMemories()}
            disabled={!botId}
          >
            Memory
          </button>
          <button
            type="button"
            className="stop-button"
            onClick={() => void loadInferenceSettings()}
            disabled={!botId}
          >
            Model settings
          </button>
          <button
            type="button"
            className="stop-button"
            onClick={() => void loadAutomations()}
            disabled={!token}
          >
            Skills & routines
          </button>
          <button
            type="button"
            className="stop-button"
            onClick={() => void loadConnectors()}
            disabled={!token}
          >
            Connectors
          </button>
          <button
            type="button"
            className="stop-button"
            onClick={() => void loadWebhooks()}
            disabled={!token}
          >
            Webhooks
          </button>
        </header>
        {inferenceProviders.length > 0 && (
          <section className="messages memory-view">
            <h2>Model settings · {bots.find((bot) => bot.id === botId)?.name}</h2>
            <label>
              Primary provider
              <select
                value={inferenceProviderId}
                onChange={(event) => setInferenceProviderId(event.target.value)}
              >
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
            <button type="button" onClick={() => void saveInferenceSettings()}>
              Save model settings
            </button>
            <button type="button" onClick={() => setInferenceProviders([])}>
              Close
            </button>
          </section>
        )}
        {webhookOpen ? (
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
        ) : connectorOpen ? (
          <section className="messages memory-view">
            <div className="memory-toolbar">
              <h2>Connectors</h2>
              <div>
                <button type="button" onClick={() => void connectService("gmail")}>
                  Connect Gmail
                </button>
                <button type="button" onClick={() => void connectService("google-calendar")}>
                  Connect Calendar
                </button>
                <button type="button" onClick={() => void connectService("google-drive")}>
                  Connect Drive
                </button>
                <button type="button" onClick={() => void loadConnectors()}>
                  Refresh
                </button>
                <button type="button" onClick={() => setConnectorOpen(false)}>
                  Back to chat
                </button>
              </div>
            </div>
            {!connectorItems.length && <p className="empty-note">No Google services connected.</p>}
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
        ) : automationOpen ? (
          <section className="messages memory-view">
            <div className="memory-toolbar">
              <h2>Skills and routines</h2>
              <div>
                <button type="button" onClick={() => void createSkill()}>
                  New skill
                </button>
                <button
                  type="button"
                  onClick={() => void createRoutine("cron")}
                  disabled={!botId || !skillItems.length}
                >
                  New cron routine
                </button>
                <button
                  type="button"
                  onClick={() => void createRoutine("webhook")}
                  disabled={!botId || !skillItems.length}
                >
                  New webhook routine
                </button>
                <button
                  type="button"
                  onClick={() => void createRoutine("inter_bot_message")}
                  disabled={
                    !botId ||
                    !skillItems.length ||
                    bots.filter((bot) => bot.id !== botId).length === 0
                  }
                >
                  New inter-bot routine
                </button>
                <button type="button" onClick={() => setAutomationOpen(false)}>
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
            <h3>Skills</h3>
            {!skillItems.length && <p className="empty-note">No skills configured.</p>}
            {skillItems.map((skill) => (
              <article className="memory-entry" key={skill.id}>
                <strong>{skill.name}</strong>
                <p>
                  {skill.description || skill.steps.map((step) => step.instruction).join(" · ")}
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
                      <div className="skill-step-editor" key={`${skill.id}-step-${index}`}>
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
                      <label>
                        Five-field cron schedule
                        <input
                          value={routineDraftSchedule}
                          onChange={(event) => setRoutineDraftSchedule(event.target.value)}
                          placeholder="0 9 * * *"
                        />
                      </label>
                    )}
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
                {routineHistory[routine.id]?.map((run) => (
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
        ) : memoryOpen ? (
          <section className="messages memory-view">
            <div className="memory-toolbar">
              <h2>Memory</h2>
              <div>
                <button type="button" onClick={() => void exportMemories()}>
                  Export JSON
                </button>
                <button type="button" onClick={() => setMemoryOpen(false)}>
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
        ) : (
          <div className="messages" ref={scrollRef}>
            {!items.length && (
              <div className="welcome">
                <div className="welcome-icon">✦</div>
                <h1>What can I help with?</h1>
                <p>
                  Send a task to your selected agent. Tool activity and approval requests appear
                  here.
                </p>
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
                  <>
                    <div className="message-label">
                      {item.role === "user"
                        ? "YOU"
                        : (bots.find((b) => b.id === botId)?.name ?? "AGENT")}
                    </div>
                    <div className="message-content">{item.content}</div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
        {error && (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {!memoryOpen && !automationOpen && !connectorOpen && (
          <form className="composer" onSubmit={(e) => void sendPrompt(e)}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={botId ? "Message your agent…" : "Connect and choose a bot first"}
              disabled={!botId}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="composer-footer">
              <span>Enter to send · Shift+Enter for a new line</span>
              <button type="submit" disabled={!botId || !draft.trim()}>
                Send <span>↗</span>
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root mount node is missing");
createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
