import pino from "pino";

export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

export function loggedError(err: unknown): { err: string; stack?: string } {
  if (err instanceof Error) return { err: err.message, stack: err.stack };
  return { err: String(err) };
}
