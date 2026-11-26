import {
  type Attributes,
  ROOT_CONTEXT,
  type Span,
  SpanStatusCode,
  context,
  trace,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";

const tracer = trace.getTracer("agentos.box-host");
let sdk: NodeSDK | undefined;

function telemetryConfigured(): boolean {
  if (process.env.OTEL_SDK_DISABLED === "true") return false;
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      (process.env.OTEL_TRACES_EXPORTER && process.env.OTEL_TRACES_EXPORTER !== "none"),
  );
}

/** Capture W3C trace context for queue handoff across async worker boundaries. */
export function currentTraceParent(): string | undefined {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (!spanContext || /^0+$/.test(spanContext.traceId) || /^0+$/.test(spanContext.spanId))
    return undefined;
  return `00-${spanContext.traceId}-${spanContext.spanId}-${(spanContext.traceFlags & 1).toString(16).padStart(2, "0")}`;
}

export function withTraceParent<T>(traceParent: string | undefined, operation: () => T): T {
  const match =
    traceParent && /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(traceParent);
  if (!match?.[1] || !match[2] || !match[3]) return operation();
  const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
    traceFlags: Number.parseInt(match[3], 16),
    isRemote: true,
  });
  return context.with(parentContext, operation);
}

export function startTelemetry(): boolean {
  if (!telemetryConfigured()) return false;
  sdk = new NodeSDK({ serviceName: process.env.OTEL_SERVICE_NAME ?? "agentos-box-host" });
  sdk.start();
  return true;
}

export async function shutdownTelemetry(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  if (current) await current.shutdown();
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T> | T,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await operation(span);
    } catch (err) {
      if (err instanceof Error) span.recordException(err);
      else span.setAttribute("error.message", String(err));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
