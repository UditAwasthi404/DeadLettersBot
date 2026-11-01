const ACTIONS: Record<string, readonly string[]> = {
  gmail: ["ListMessages", "ReadMessage", "SendMessage", "ApplyLabel", "GetAttachment"],
  "google-calendar": ["ListEvents", "CreateEvent", "UpdateEvent", "DeleteEvent", "GetFreeBusy"],
  "google-drive": ["ListFiles", "ReadFile", "WriteFile", "ShareFile"],
  onedrive: ["ListFiles", "ReadFile", "WriteFile", "ShareFile"],
  "outlook-mail": ["ListMessages", "ReadMessage", "SendMessage", "ApplyLabel", "GetAttachment"],
  "outlook-calendar": ["ListEvents", "CreateEvent", "UpdateEvent", "DeleteEvent", "GetFreeBusy"],
  teams: ["ListChannels", "PostMessage", "ReadChannel", "ListFiles"],
  sharepoint: ["ListSites", "ListItems", "ReadItem", "WriteItem"],
  salesforce: ["QueryRecords", "GetRecord", "CreateRecord", "UpdateRecord"],
};

/** Prompt text for the connectors stored for this account. Read again on every turn. */
export function describeConnectedConnectors(services: readonly string[]): string {
  const unique = [...new Set(services.map((service) => service.trim()).filter(Boolean))];
  if (!unique.length) {
    return [
      "No OAuth connectors are connected for this account.",
      "ConnectorCall will fail until the user connects a service in the Connectors screen.",
    ].join(" ");
  }
  const lines = unique.map((service) => {
    const actions = ACTIONS[service] ?? [];
    const send = actions.includes("SendMessage")
      ? ` ${service} is connected. Send mail with ConnectorCall service "${service}" action "SendMessage" and params {"to","subject","body"}.`
      : ` ${service} is connected.`;
    return `- ${service}: ${actions.join(", ")}.${send}`;
  });
  return [
    "OAuth connectors connected for this account on this turn (no restart required):",
    ...lines,
    "If a service is listed above, it is connected. Call ConnectorCall. Do not tell the user that a listed service is disconnected.",
    "Services that are not listed are not connected.",
  ].join("\n");
}
