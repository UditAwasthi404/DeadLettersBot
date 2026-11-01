export type ConnectorEventTrigger = {
  type: "connector_event";
  service: "gmail" | "google-calendar";
  sender?: string;
  subject?: string;
  query?: string;
  calendarId?: string;
};

function optionalText(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 200 || /[\r\n\0]/.test(trimmed)) return null;
  return trimmed;
}

export function normalizeConnectorEventTrigger(input: {
  service?: unknown;
  sender?: unknown;
  subject?: unknown;
  query?: unknown;
  calendarId?: unknown;
}): ConnectorEventTrigger | null {
  if (input.service !== "gmail" && input.service !== "google-calendar") return null;
  const sender = optionalText(input.sender);
  const subject = optionalText(input.subject);
  const query = optionalText(input.query);
  const calendarId = optionalText(input.calendarId);
  if (sender === null || subject === null || query === null || calendarId === null) return null;
  if (calendarId && !/^[A-Za-z0-9@._+-]+$/.test(calendarId)) return null;
  return {
    type: "connector_event",
    service: input.service,
    ...(sender ? { sender } : {}),
    ...(subject ? { subject } : {}),
    ...(query ? { query } : {}),
    ...(calendarId ? { calendarId } : {}),
  };
}

export function gmailEventQuery(trigger: {
  query?: string;
  sender?: string;
  subject?: string;
}): string {
  const parts = ["in:inbox", "newer_than:2d"];
  if (trigger.sender) parts.push(gmailTerm("from", trigger.sender));
  if (trigger.subject) parts.push(gmailTerm("subject", trigger.subject));
  if (trigger.query) parts.push(trigger.query);
  return parts.join(" ").slice(0, 500);
}

function gmailTerm(prefix: string, value: string): string {
  const cleaned = value.replaceAll('"', "");
  return /[\s]/.test(cleaned) ? `${prefix}:"${cleaned}"` : `${prefix}:${cleaned}`;
}
