/**
 * Eval entry point (REQ-H05, REQ-TEST04).
 * Runs an isolated agent loop with a local sandbox VM and scripted or synthetic inference.
 * Usage: bun run src/index.ts --eval-mode <request.json> [result.json]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  STATIC_CATALOG,
  assembleTurnAction,
  buildDefaultSections,
  buildUserInfoMessage,
  dispatchTool,
  renderSystemPrompt,
  toInferenceTool,
} from "@agentos/agent-core";
import type {
  InferenceSession,
  InferenceStreamEvent,
  InferenceTool,
  ProviderFactory,
} from "@agentos/inference";
import type {
  Attachment,
  Bot,
  ModelMessage,
  TokenUsage,
  ToolCall,
  ToolResult,
} from "@agentos/shared";
import type { ExecResult, VMInfo, VMManager } from "@agentos/vm-manager";

export type EvalFixtureEvent =
  | { type: "token"; delta: string }
  | { type: "toolCall"; toolCall: { id?: string; name: string; args?: Record<string, unknown> } }
  | { type: "usage"; usage: Partial<TokenUsage> }
  | { type: "ok" };

export interface EvalRequest {
  prompt: string;
  systemOverride?: string;
  disabledToolIds?: string[];
  simulatedTime?: string;
  selectedImages?: Array<{ id?: string; name?: string; mimeType?: string; uri: string }>;
  syntheticHistory?: ModelMessage[];
  /** Synthetic "ok" reply, or an explicit stream script. */
  fixture?: "ok" | EvalFixtureEvent[];
  stepBudget?: number;
  botName?: string;
}

export interface EvalResult {
  status: "completed" | "error" | "step_budget";
  updates: string[];
  deliveries: string[];
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
  }>;
  tokenUsage: TokenUsage;
  error?: string;
  simulatedTime?: string;
}

const emptyUsage = (): TokenUsage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  source: "estimate",
});

function mergeUsage(total: TokenUsage, next: TokenUsage): TokenUsage {
  const cachedPromptTokens = (total.cachedPromptTokens ?? 0) + (next.cachedPromptTokens ?? 0);
  const cacheWritePromptTokens =
    (total.cacheWritePromptTokens ?? 0) + (next.cacheWritePromptTokens ?? 0);
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
    ...(cachedPromptTokens > 0 ? { cachedPromptTokens } : {}),
    ...(cacheWritePromptTokens > 0 ? { cacheWritePromptTokens } : {}),
    source: next.source ?? total.source,
  };
}

/** In-memory workspace used instead of a real account VM (LocalExecSandBox). */
export class LocalExecSandBox implements VMManager {
  readonly files = new Map<string, string>();

  async provisionVM(accountId: string): Promise<VMInfo> {
    return { vmId: `eval-${accountId}`, accountId, status: "running" };
  }
  async wakeVM(vmId: string): Promise<VMInfo> {
    return { vmId, accountId: "eval", status: "running" };
  }
  async suspendVM(): Promise<void> {}
  async terminateVM(): Promise<void> {}
  async getVMStatus(vmId: string): Promise<VMInfo> {
    return { vmId, accountId: "eval", status: "running" };
  }
  async listVMs(): Promise<VMInfo[]> {
    return [];
  }
  async getVMStats() {
    return undefined;
  }
  async ensureBotBrowser(): Promise<number> {
    return 9222;
  }
  async ensureBotVnc(): Promise<number> {
    return 7000;
  }
  async watchFiles(): Promise<{ stop: () => Promise<void>; done: Promise<void> }> {
    return { stop: async () => {}, done: new Promise(() => {}) };
  }

  async execInContainer(_vmId: string, cmd: string[], input?: string): Promise<ExecResult> {
    if (cmd[0] === "agentos-file") {
      const operation = cmd[1] ?? "";
      const path = cmd[2] ?? "";
      if (operation === "read") {
        const content = this.files.get(path);
        if (content === undefined)
          return { stdout: "", stderr: `missing file: ${path}`, exitCode: 1 };
        return { stdout: content, stderr: "", exitCode: 0 };
      }
      if (operation === "write") {
        this.files.set(path, input ?? "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (operation === "append") {
        this.files.set(path, `${this.files.get(path) ?? ""}${input ?? ""}`);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (operation === "delete") {
        this.files.delete(path);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (operation === "list") {
        const prefix = path.endsWith("/") ? path : `${path}/`;
        const names = [
          ...new Set(
            [...this.files.keys()]
              .filter((key) => key === path || key.startsWith(prefix))
              .map((key) => {
                const rest = key === path ? "." : key.slice(prefix.length);
                return rest.split("/")[0] || ".";
              }),
          ),
        ];
        return { stdout: `${names.sort().join("\n")}\n`, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: `unsupported file operation: ${operation}`, exitCode: 1 };
    }

    if (cmd.includes("agentos-shell") || cmd[0] === "setpriv" || cmd[0] === "sh") {
      const script = cmd[cmd.length - 1] ?? "";
      const echo = script.match(/^echo\s+(.*)$/s);
      if (echo) {
        return {
          stdout: `${echo[1]?.replace(/^['"]|['"]$/g, "") ?? ""}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    return { stdout: "", stderr: `unsupported eval command: ${cmd[0] ?? ""}`, exitCode: 1 };
  }
}

class FixtureSession implements InferenceSession {
  readonly providerId = "eval";
  readonly purpose;
  private readonly events: EvalFixtureEvent[];
  private index = 0;

  constructor(purpose: InferenceSession["purpose"], events: EvalFixtureEvent[]) {
    this.purpose = purpose;
    this.events = events;
  }

  async *streamComplete(
    messages: ModelMessage[],
    _tools?: InferenceTool[],
  ): AsyncIterable<InferenceStreamEvent> {
    const remaining = this.events.slice(this.index);
    if (remaining.length === 0) {
      const reply = "ok";
      yield { type: "token", delta: reply };
      yield {
        type: "toolCall",
        toolCall: {
          id: `eval-${crypto.randomUUID()}`,
          name: "SendToUser",
          args: { content: reply, endTurn: true },
        },
      };
      return;
    }

    const batch: EvalFixtureEvent[] = [];
    while (this.index < this.events.length) {
      const event = this.events[this.index++];
      if (!event) break;
      batch.push(event);
      if (event.type === "toolCall" || event.type === "ok") break;
    }

    for (const event of batch) {
      if (event.type === "ok") {
        const reply = "ok";
        yield { type: "token", delta: reply };
        yield {
          type: "toolCall",
          toolCall: {
            id: `eval-${crypto.randomUUID()}`,
            name: "SendToUser",
            args: { content: reply, endTurn: true },
          },
        };
        continue;
      }
      if (event.type === "token") {
        yield { type: "token", delta: event.delta };
        continue;
      }
      if (event.type === "usage") {
        yield {
          type: "usage",
          usage: {
            promptTokens:
              event.usage.promptTokens ??
              Math.max(1, Math.ceil(JSON.stringify(messages).length / 4)),
            completionTokens: event.usage.completionTokens ?? 1,
            totalTokens:
              event.usage.totalTokens ??
              (event.usage.promptTokens ?? 1) + (event.usage.completionTokens ?? 1),
            cachedPromptTokens: event.usage.cachedPromptTokens,
            cacheWritePromptTokens: event.usage.cacheWritePromptTokens,
            source: event.usage.source ?? "provider",
          },
        };
        continue;
      }
      yield {
        type: "toolCall",
        toolCall: {
          id: event.toolCall.id ?? `eval-${crypto.randomUUID()}`,
          name: event.toolCall.name,
          args: event.toolCall.args ?? {},
        },
      };
    }
  }
}

function fixtureEvents(request: EvalRequest): EvalFixtureEvent[] {
  if (request.fixture === "ok" || request.fixture === undefined) return [{ type: "ok" }];
  return request.fixture;
}

export function createEvalProvider(request: EvalRequest): ProviderFactory {
  const events = fixtureEvents(request);
  return {
    id: "eval",
    createSession(purpose) {
      return new FixtureSession(purpose, events);
    },
  };
}

function evalBot(request: EvalRequest): Bot {
  const now = request.simulatedTime ? new Date(request.simulatedTime) : new Date();
  return {
    id: "eval-bot",
    accountId: "eval-account",
    name: request.botName ?? "EvalBot",
    systemPrompt: request.systemOverride ?? "",
    profileText: "",
    role: "main",
    skills: [],
    tools: [],
    localMachineAccess: "never",
    retainData: true,
    memorySettings: { agentScope: true, userScope: true, projectScope: false },
    approvalSettings: { autoReviewRules: [], defaultLevel: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

export async function runEvalMode(request: EvalRequest): Promise<EvalResult> {
  const bot = evalBot(request);
  const disabled = new Set(request.disabledToolIds ?? []);
  const catalog = STATIC_CATALOG.filter((tool) => !disabled.has(tool.name));
  const sections = buildDefaultSections(bot);
  if (request.systemOverride) sections.base = request.systemOverride;
  if (request.simulatedTime) {
    sections.computer = `${sections.computer}\nSimulated time: ${request.simulatedTime}`;
  }
  const system = renderSystemPrompt(sections);
  const attachments: Attachment[] = (request.selectedImages ?? []).map((image, index) => ({
    id: image.id ?? `img-${index}`,
    name: image.name ?? `image-${index}`,
    mimeType: image.mimeType ?? "image/png",
    sizeBytes: 1,
    uri: image.uri,
  }));
  const messages: ModelMessage[] = [
    { role: "system", content: system },
    buildUserInfoMessage(catalog.map(toInferenceTool)),
    ...(request.syntheticHistory ?? []),
    assembleTurnAction(request.prompt, attachments),
  ];

  const sandbox = new LocalExecSandBox();
  const session = createEvalProvider(request).createSession("main");
  const tools = catalog.map(toInferenceTool);
  const stepBudget = Math.max(1, Math.min(request.stepBudget ?? 20, 50));
  const deliveries: string[] = [];
  const updates: string[] = [];
  const toolCalls: EvalResult["toolCalls"] = [];
  let usage = emptyUsage();
  let endTurn = false;

  try {
    for (let step = 0; step < stepBudget; step += 1) {
      const pendingCalls: ToolCall[] = [];
      let assistantText = "";
      for await (const event of session.streamComplete(messages, tools)) {
        if (event.type === "token") {
          assistantText += event.delta;
          updates.push(event.delta);
        } else if (event.type === "usage") {
          usage = mergeUsage(usage, event.usage);
        } else if (event.type === "toolCall") {
          pendingCalls.push(event.toolCall);
        }
      }

      if (assistantText) messages.push({ role: "assistant", content: assistantText });
      if (pendingCalls.length === 0) {
        return {
          status: "completed",
          updates,
          deliveries,
          toolCalls,
          tokenUsage: usage,
          simulatedTime: request.simulatedTime,
        };
      }

      messages.push({
        role: "assistant",
        content: "",
        toolCalls: pendingCalls,
      });

      const results: ToolResult[] = [];
      for (const call of pendingCalls) {
        if (call.name === "SendToUser") {
          const content = String(call.args.content ?? "");
          deliveries.push(content);
          updates.push(content);
          toolCalls.push({ name: call.name, args: call.args, result: { ok: true } });
          results.push({ toolCallId: call.id, name: call.name, result: { ok: true } });
          if (call.args.endTurn === true || call.args.end_turn === true) endTurn = true;
          continue;
        }

        const result = await dispatchTool(call, catalog, bot.approvalSettings, {
          vm: sandbox,
          vmId: "eval-vm",
          browser: null,
        });
        toolCalls.push({
          name: call.name,
          args: call.args,
          result: result.result,
          isError: result.isError,
        });
        results.push(result);
      }

      for (const result of results) {
        messages.push({
          role: "tool",
          content:
            typeof result.result === "string" ? result.result : JSON.stringify(result.result),
          toolCallId: result.toolCallId,
          name: result.name,
        });
      }

      if (endTurn) {
        return {
          status: "completed",
          updates,
          deliveries,
          toolCalls,
          tokenUsage: usage,
          simulatedTime: request.simulatedTime,
        };
      }
    }

    return {
      status: "step_budget",
      updates,
      deliveries,
      toolCalls,
      tokenUsage: usage,
      error: `step budget of ${stepBudget} exhausted`,
      simulatedTime: request.simulatedTime,
    };
  } catch (err) {
    return {
      status: "error",
      updates,
      deliveries,
      toolCalls,
      tokenUsage: usage,
      error: err instanceof Error ? err.message : String(err),
      simulatedTime: request.simulatedTime,
    };
  }
}

export function parseEvalArgs(argv: string[]): { requestPath: string; resultPath: string } | null {
  const index = argv.indexOf("--eval-mode");
  if (index < 0) return null;
  const requestPath = argv[index + 1];
  if (!requestPath) throw new Error("--eval-mode requires a request.json path");
  const resultPath = argv[index + 2] ?? resolve(dirname(resolve(requestPath)), "result.json");
  return { requestPath: resolve(requestPath), resultPath: resolve(resultPath) };
}

export async function runEvalModeFromFiles(
  requestPath: string,
  resultPath: string,
): Promise<EvalResult> {
  const raw = await readFile(requestPath, "utf8");
  const request = JSON.parse(raw) as EvalRequest;
  if (!request.prompt || typeof request.prompt !== "string")
    throw new Error("request.json must include a string prompt");
  const result = await runEvalMode(request);
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}
