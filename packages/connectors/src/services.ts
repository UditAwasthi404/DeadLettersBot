const GRAPH = "https://graph.microsoft.com/v1.0";
const RESPONSE_CHARS = 8_000;
const FILE_BYTES = 1_000_000;

const MICROSOFT_ACTIONS: Record<string, readonly string[]> = {
  onedrive: ["ListFiles", "ReadFile", "WriteFile", "ShareFile"],
  "outlook-mail": ["ListMessages", "ReadMessage", "SendMessage", "ApplyLabel", "GetAttachment"],
  "outlook-calendar": ["ListEvents", "CreateEvent", "UpdateEvent", "DeleteEvent", "GetFreeBusy"],
  teams: ["ListChannels", "PostMessage", "ReadChannel", "ListFiles"],
  sharepoint: ["ListSites", "ListItems", "ReadItem", "WriteItem"],
};

function encode(value: unknown): string {
  return encodeURIComponent(String(value ?? ""));
}

function isSafeUploadMime(mimeType: string): boolean {
  const match = /^([^\s;]+)(?:\s*;\s*charset\s*=\s*([A-Za-z0-9._-]+))?$/.exec(mimeType.trim());
  if (!match?.[1] || /[\r\n\0]/.test(mimeType)) return false;
  const type = match[1].toLowerCase();
  return type === "application/json" || /^text\/[a-z0-9][a-z0-9.+-]*$/.test(type);
}

function requireId(args: Record<string, unknown>, key: string): string {
  const value = String(args[key] ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function boundPayload(text: string): unknown {
  if (text.length <= RESPONSE_CHARS) return text ? (JSON.parse(text) as unknown) : { ok: true };
  return { truncated: true, content: text.slice(0, RESPONSE_CHARS) };
}

async function readBounded(response: Response, label: string): Promise<string> {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${label} failed (${response.status}): ${error.slice(0, 500)}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType &&
    !contentType.startsWith("text/") &&
    !contentType.includes("json") &&
    !contentType.includes("xml")
  )
    throw new Error(`unsupported file content type: ${contentType}`);
  if (Number(response.headers.get("content-length") ?? 0) > FILE_BYTES)
    throw new Error("file exceeds 1 MB read limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > FILE_BYTES) throw new Error("file exceeds 1 MB read limit");
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function graph(
  method: string,
  path: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  body?: unknown,
  raw = false,
): Promise<unknown> {
  const response = await fetchImpl(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) {
    const content = await readBounded(response, "Microsoft file read");
    return { contentType: response.headers.get("content-type") ?? "text/plain", content };
  }
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Microsoft request failed (${response.status}): ${text.slice(0, 500)}`);
  return boundPayload(text);
}

async function microsoftCall(
  service: string,
  action: string,
  args: Record<string, unknown>,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const allowed = MICROSOFT_ACTIONS[service];
  if (!allowed?.includes(action)) throw new Error(`unsupported ${service} action: ${action}`);
  if (service === "onedrive") {
    if (action === "ListFiles") {
      const top = Math.max(1, Math.min(100, Number(args.pageSize ?? 50)));
      return graph("GET", `/me/drive/root/children?$top=${top}`, accessToken, fetchImpl);
    }
    if (action === "ReadFile")
      return graph(
        "GET",
        `/me/drive/items/${encode(requireId(args, "fileId"))}/content`,
        accessToken,
        fetchImpl,
        undefined,
        true,
      );
    if (action === "WriteFile") {
      const content = String(args.content ?? "");
      if (new TextEncoder().encode(content).byteLength > FILE_BYTES)
        throw new Error("file content exceeds 1 MB");
      const mimeType = String(args.mimeType ?? "text/plain").trim();
      if (!isSafeUploadMime(mimeType))
        throw new Error("WriteFile supports text and JSON files only");
      const target = args.fileId
        ? `/me/drive/items/${encode(args.fileId)}/content`
        : `/me/drive/root:/${encode(requireId(args, "name"))}:/content`;
      const response = await fetchImpl(`${GRAPH}${target}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mimeType },
        body: content,
      });
      const text = await response.text();
      if (!response.ok)
        throw new Error(`OneDrive WriteFile failed (${response.status}): ${text.slice(0, 500)}`);
      return boundPayload(text);
    }
    return graph(
      "POST",
      `/me/drive/items/${encode(requireId(args, "fileId"))}/invite`,
      accessToken,
      fetchImpl,
      {
        recipients: [{ email: String(requireId(args, "emailAddress")).slice(0, 320) }],
        roles: [args.role === "writer" ? "write" : "read"],
        requireSignIn: true,
        sendInvitation: true,
      },
    );
  }
  if (service === "outlook-mail") {
    if (action === "ListMessages") {
      const top = Math.max(1, Math.min(100, Number(args.maxResults ?? 20)));
      const search = args.query ? `&$search=${encode(String(args.query).slice(0, 500))}` : "";
      return graph(
        "GET",
        `/me/messages?$top=${top}&$select=id,subject,from,receivedDateTime,bodyPreview${search}`,
        accessToken,
        fetchImpl,
      );
    }
    if (action === "ReadMessage")
      return graph(
        "GET",
        `/me/messages/${encode(requireId(args, "messageId"))}?$select=id,subject,from,toRecipients,bodyPreview,body`,
        accessToken,
        fetchImpl,
      );
    if (action === "SendMessage")
      return graph("POST", "/me/sendMail", accessToken, fetchImpl, {
        message: {
          subject: String(args.subject ?? "").slice(0, 500),
          body: { contentType: "Text", content: String(args.body ?? "").slice(0, 100_000) },
          toRecipients: [
            { emailAddress: { address: String(requireId(args, "to")).slice(0, 320) } },
          ],
        },
      });
    if (action === "ApplyLabel")
      return graph(
        "PATCH",
        `/me/messages/${encode(requireId(args, "messageId"))}`,
        accessToken,
        fetchImpl,
        { categories: Array.isArray(args.labelIds) ? args.labelIds.map(String).slice(0, 20) : [] },
      );
    const attachment = await graph(
      "GET",
      `/me/messages/${encode(requireId(args, "messageId"))}/attachments/${encode(requireId(args, "attachmentId"))}`,
      accessToken,
      fetchImpl,
    );
    if (
      attachment &&
      typeof attachment === "object" &&
      "contentBytes" in attachment &&
      typeof attachment.contentBytes === "string" &&
      attachment.contentBytes.length > FILE_BYTES
    )
      return {
        ...attachment,
        contentBytes: attachment.contentBytes.slice(0, FILE_BYTES),
        truncated: true,
      };
    return attachment;
  }
  if (service === "outlook-calendar") {
    if (action === "ListEvents") {
      const top = Math.max(1, Math.min(250, Number(args.maxResults ?? 50)));
      return graph("GET", `/me/calendar/events?$top=${top}`, accessToken, fetchImpl);
    }
    if (action === "CreateEvent")
      return graph("POST", "/me/calendar/events", accessToken, fetchImpl, args.event ?? {});
    if (action === "UpdateEvent")
      return graph(
        "PATCH",
        `/me/events/${encode(requireId(args, "eventId"))}`,
        accessToken,
        fetchImpl,
        args.event ?? {},
      );
    if (action === "DeleteEvent")
      return graph(
        "DELETE",
        `/me/events/${encode(requireId(args, "eventId"))}`,
        accessToken,
        fetchImpl,
      );
    return graph("POST", "/me/calendar/getSchedule", accessToken, fetchImpl, {
      schedules: args.calendars ?? [],
      startTime: args.timeMin,
      endTime: args.timeMax,
    });
  }
  if (service === "teams") {
    const teamId = args.teamId ? encode(args.teamId) : "";
    const channelId = args.channelId ? encode(args.channelId) : "";
    if (action === "ListChannels")
      return graph(
        "GET",
        teamId ? `/teams/${teamId}/channels` : "/me/joinedTeams",
        accessToken,
        fetchImpl,
      );
    if (!teamId || !channelId) throw new Error("teamId and channelId are required");
    if (action === "PostMessage")
      return graph(
        "POST",
        `/teams/${teamId}/channels/${channelId}/messages`,
        accessToken,
        fetchImpl,
        { body: { content: String(args.body ?? args.content ?? "").slice(0, 20_000) } },
      );
    if (action === "ReadChannel")
      return graph(
        "GET",
        `/teams/${teamId}/channels/${channelId}/messages?$top=20`,
        accessToken,
        fetchImpl,
      );
    return graph(
      "GET",
      `/teams/${teamId}/channels/${channelId}/filesFolder/children?$top=50`,
      accessToken,
      fetchImpl,
    );
  }
  if (action === "ListSites")
    return graph(
      "GET",
      `/sites?search=${encode(String(args.query ?? "*").slice(0, 200))}`,
      accessToken,
      fetchImpl,
    );
  const siteId = encode(requireId(args, "siteId"));
  const listId = encode(requireId(args, "listId"));
  if (action === "ListItems")
    return graph(
      "GET",
      `/sites/${siteId}/lists/${listId}/items?$top=50&$expand=fields`,
      accessToken,
      fetchImpl,
    );
  if (action === "ReadItem")
    return graph(
      "GET",
      `/sites/${siteId}/lists/${listId}/items/${encode(requireId(args, "itemId"))}?$expand=fields`,
      accessToken,
      fetchImpl,
    );
  const itemPath = args.itemId
    ? `/sites/${siteId}/lists/${listId}/items/${encode(args.itemId)}/fields`
    : `/sites/${siteId}/lists/${listId}/items`;
  return graph(args.itemId ? "PATCH" : "POST", itemPath, accessToken, fetchImpl, {
    fields: args.fields ?? args.item ?? {},
  });
}

function salesforceInstance(instanceUrl: string | undefined): URL {
  if (!instanceUrl) throw new Error("Salesforce instance URL is missing; reconnect Salesforce");
  const url = new URL(instanceUrl);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    !(host.endsWith(".salesforce.com") || host.endsWith(".force.com"))
  )
    throw new Error("Salesforce instance URL is not a Salesforce host");
  return url;
}

async function salesforceCall(
  action: string,
  args: Record<string, unknown>,
  accessToken: string,
  instanceUrl: string | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const allowed = ["QueryRecords", "GetRecord", "CreateRecord", "UpdateRecord"];
  if (!allowed.includes(action)) throw new Error(`unsupported salesforce action: ${action}`);
  const instance = salesforceInstance(instanceUrl);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  let method = "GET";
  let path = "";
  let body: unknown;
  if (action === "QueryRecords") {
    const query = String(args.query ?? args.q ?? "").trim();
    if (!query || query.length > 2000)
      throw new Error("SOQL query is required and limited to 2000 characters");
    path = `/services/data/v59.0/query?q=${encode(query)}`;
  } else {
    const objectType = String(requireId(args, "objectType"));
    if (!/^[A-Za-z0-9_]+$/.test(objectType)) throw new Error("objectType is invalid");
    if (action === "GetRecord" || action === "UpdateRecord") {
      const id = requireId(args, "recordId");
      if (!/^[A-Za-z0-9]{15,18}$/.test(id)) throw new Error("recordId is invalid");
      path = `/services/data/v59.0/sobjects/${objectType}/${id}`;
      if (action === "UpdateRecord") {
        method = "PATCH";
        body = args.fields ?? {};
      }
    } else {
      method = "POST";
      path = `/services/data/v59.0/sobjects/${objectType}`;
      body = args.fields ?? {};
    }
  }
  const response = await fetchImpl(`${instance.origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Salesforce ${action} failed (${response.status}): ${text.slice(0, 500)}`);
  return boundPayload(text);
}

export async function callConnector(
  service: string,
  action: string,
  args: Record<string, unknown>,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  instanceUrl?: string | null,
): Promise<unknown> {
  if (service === "salesforce")
    return salesforceCall(action, args, accessToken, instanceUrl ?? undefined, fetchImpl);
  if (MICROSOFT_ACTIONS[service])
    return microsoftCall(service, action, args, accessToken, fetchImpl);
  throw new Error(`unsupported connector service: ${service}`);
}

export async function revokeConnectorToken(
  service: string,
  token: string,
  instanceUrl?: string | null,
  fetchImpl: typeof fetch = fetch,
  client?: { clientId?: string; clientSecret?: string },
): Promise<boolean> {
  if (service === "microsoft") {
    const body = new URLSearchParams({ token, token_type_hint: "access_token" });
    if (client?.clientId) body.set("client_id", client.clientId);
    if (client?.clientSecret) body.set("client_secret", client.clientSecret);
    const response = await fetchImpl(
      "https://login.microsoftonline.com/common/oauth2/v2.0/revoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5_000),
      },
    );
    return response.ok;
  }
  if (service === "salesforce") {
    const instance = instanceUrl
      ? salesforceInstance(instanceUrl)
      : new URL("https://login.salesforce.com");
    const response = await fetchImpl(`${instance.origin}/services/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  }
  const response = await fetchImpl("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(5_000),
  });
  return response.ok;
}
