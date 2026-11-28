import { AsyncLocalStorage } from "node:async_hooks";
import { trace } from "@opentelemetry/api";
import pino from "pino";

export interface LogContext {
  requestId?: string;
  connectionId?: string;
  accountId?: string;
  botId?: string;
  turnId?: string;
  runId?: string;
  frameType?: string;
}

const context = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(fields: LogContext, callback: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, callback);
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  mixin: () => {
    const spanContext = trace.getActiveSpan()?.spanContext();
    return {
      ...context.getStore(),
      ...(spanContext && trace.isSpanContextValid(spanContext)
        ? { traceId: spanContext.traceId, spanId: spanContext.spanId }
        : {}),
    };
  },
});

export function loggedError(err: unknown): { err: string; stack?: string; cause?: string } {
  if (err instanceof Error) {
    const cause =
      err.cause instanceof Error
        ? err.cause.message
        : err.cause !== undefined
          ? String(err.cause)
          : undefined;
    return { err: err.message, stack: err.stack, ...(cause ? { cause } : {}) };
  }
  return { err: String(err) };
}
