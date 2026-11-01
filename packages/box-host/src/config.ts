const PROVIDERS = new Set(["openai", "anthropic", "xai", "ollama", "mock"]);

function requireValue(name: string, errors: string[]): string {
  const value = process.env[name]?.trim();
  if (!value) errors.push(`${name} is required`);
  return value ?? "";
}

function positiveInteger(name: string, fallback: number, errors: string[], max: number): void {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max)
    errors.push(`${name} must be an integer from 1 to ${max} (default ${fallback})`);
}

function nonNegativeInteger(name: string, fallback: number, errors: string[], max: number): void {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max)
    errors.push(`${name} must be an integer from 0 to ${max} (default ${fallback})`);
}

function booleanValue(name: string, errors: string[], allowed = ["0", "1"]): void {
  const raw = process.env[name];
  if (raw !== undefined && raw !== "" && !allowed.includes(raw))
    errors.push(`${name} must be one of ${allowed.join(", ")}`);
}

/** Validate deployment-critical configuration before opening DB, Redis or Docker connections. */
export function validateRuntimeConfig(): void {
  const errors: string[] = [];
  const databaseUrl = requireValue("DATABASE_URL", errors);
  const redisUrl = requireValue("REDIS_URL", errors);
  const s3Endpoint = requireValue("S3_ENDPOINT", errors);
  requireValue("S3_ACCESS_KEY", errors);
  requireValue("S3_SECRET_KEY", errors);
  const jwtSecret = requireValue("JWT_SECRET", errors);
  const previousJwtSecret = process.env.JWT_SECRET_PREVIOUS?.trim();
  const encryptionKey = requireValue("CONNECTOR_ENCRYPTION_KEY", errors);
  const previousEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS?.trim();
  const production = process.env.NODE_ENV === "production";

  if (databaseUrl && !/^postgres(?:ql)?:\/\//i.test(databaseUrl))
    errors.push("DATABASE_URL must use postgres:// or postgresql://");
  if (redisUrl && !/^rediss?:\/\//i.test(redisUrl))
    errors.push("REDIS_URL must use redis:// or rediss://");
  if (s3Endpoint) {
    try {
      const url = new URL(s3Endpoint);
      if (url.protocol !== "http:" && url.protocol !== "https:")
        errors.push("S3_ENDPOINT must use http:// or https://");
    } catch {
      errors.push("S3_ENDPOINT must be a valid URL");
    }
  }
  if (!/^[\da-fA-F]{64}$/.test(encryptionKey))
    errors.push("CONNECTOR_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters");
  if (previousEncryptionKey && !/^[\da-fA-F]{64}$/.test(previousEncryptionKey))
    errors.push("CONNECTOR_ENCRYPTION_KEY_PREVIOUS must be 32 bytes encoded as 64 hex characters");
  if (previousEncryptionKey && previousEncryptionKey === encryptionKey)
    errors.push("CONNECTOR_ENCRYPTION_KEY_PREVIOUS must differ from CONNECTOR_ENCRYPTION_KEY");
  if (previousJwtSecret && previousJwtSecret === jwtSecret)
    errors.push("JWT_SECRET_PREVIOUS must differ from JWT_SECRET");
  if (production) {
    if (jwtSecret.length < 32)
      errors.push("JWT_SECRET must be at least 32 characters in production");
    if (/change-me|dev-secret|example/i.test(jwtSecret))
      errors.push("JWT_SECRET must not use a development placeholder in production");
    if (previousJwtSecret && previousJwtSecret.length < 32)
      errors.push("JWT_SECRET_PREVIOUS must be at least 32 characters in production");
    if (/^0+$/.test(encryptionKey))
      errors.push("CONNECTOR_ENCRYPTION_KEY must not use an all-zero placeholder in production");
    if (previousEncryptionKey && /^0+$/.test(previousEncryptionKey))
      errors.push(
        "CONNECTOR_ENCRYPTION_KEY_PREVIOUS must not use an all-zero placeholder in production",
      );
    if (process.env.INFERENCE_MOCK === "1")
      errors.push("INFERENCE_MOCK cannot be enabled in production");
  }

  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    errors.push("PORT must be an integer from 1 to 65535");
  positiveInteger("BOT_STEP_BUDGET", 50, errors, 500);
  const contextTokens = Number(process.env.MODEL_CONTEXT_TOKENS ?? 128_000);
  if (!Number.isInteger(contextTokens) || contextTokens < 8_000 || contextTokens > 2_000_000)
    errors.push("MODEL_CONTEXT_TOKENS must be an integer from 8000 to 2000000 (default 128000)");
  positiveInteger("API_RATE_LIMIT_PER_MINUTE", 120, errors, 1_000_000);
  positiveInteger("VM_MEMORY_BYTES", 2_147_483_648, errors, Number.MAX_SAFE_INTEGER);
  positiveInteger("VM_CPU_NANOS", 2_000_000_000, errors, Number.MAX_SAFE_INTEGER);
  positiveInteger("VM_PIDS_LIMIT", 512, errors, 1_000_000);
  positiveInteger("VM_IDLE_TIMEOUT_MS", 600_000, errors, Number.MAX_SAFE_INTEGER);
  positiveInteger("WEBHOOK_MAX_ATTEMPTS", 6, errors, 10);
  nonNegativeInteger("WEBHOOK_DELIVERY_RETENTION_DAYS", 30, errors, 3650);
  booleanValue("INFERENCE_MOCK", errors);
  booleanValue("S3_FORCE_PATH_STYLE", errors, ["0", "1", "false", "true"]);
  booleanValue("METRICS_ENABLED", errors);
  booleanValue("MEMORY_SYNTHESIS_ENABLED", errors);
  booleanValue("MCP_STRICT_MODE", errors);
  booleanValue("BOX_HOSTED_FOR_AUTOMATION_SYNC", errors);
  if (process.env.SUBAGENT_STALL_MS !== undefined && process.env.SUBAGENT_STALL_MS !== "") {
    const stallMs = Number(process.env.SUBAGENT_STALL_MS);
    if (!Number.isInteger(stallMs) || stallMs < 1_000 || stallMs > 86_400_000)
      errors.push("SUBAGENT_STALL_MS must be an integer from 1000 to 86400000 (default 180000)");
  }

  const providerNames = (process.env.INFERENCE_PROVIDERS ?? "xai")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  if (process.env.INFERENCE_MOCK !== "1") {
    if (providerNames.length === 0)
      errors.push("INFERENCE_PROVIDERS must contain at least one provider");
    for (const provider of providerNames) {
      if (!PROVIDERS.has(provider)) errors.push(`unknown inference provider: ${provider}`);
      if (production && provider === "mock")
        errors.push("mock cannot be selected in INFERENCE_PROVIDERS in production");
    }
    if (providerNames.includes("xai") && !process.env.XAI_API_KEY?.trim())
      errors.push("XAI_API_KEY is required when xai is an inference provider");
    if (providerNames.includes("openai") && !process.env.OPENAI_API_KEY?.trim())
      errors.push("OPENAI_API_KEY is required when openai is an inference provider");
    if (providerNames.includes("anthropic") && !process.env.ANTHROPIC_API_KEY?.trim())
      errors.push("ANTHROPIC_API_KEY is required when anthropic is an inference provider");
  }

  if (errors.length) throw new Error(`Invalid runtime configuration:\n- ${errors.join("\n- ")}`);
}
