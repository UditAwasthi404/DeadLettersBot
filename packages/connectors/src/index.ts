export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthorizationParams?: Record<string, string>;
}
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
  /** Salesforce web-server responses include the instance the REST calls must use. */
  instanceUrl?: string;
}

export function googleOAuthConfig(
  service: string,
  clientId: string,
  clientSecret?: string,
): OAuthConfig {
  const scopes: Record<string, string[]> = {
    gmail: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    "google-calendar": [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    "google-drive": ["https://www.googleapis.com/auth/drive"],
  };
  const serviceScopes = scopes[service];
  if (!serviceScopes) throw new Error("unsupported Google connector service");
  return {
    clientId,
    clientSecret,
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: serviceScopes,
    extraAuthorizationParams: { access_type: "offline", prompt: "consent" },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function encryptionKeyBytes(hex = ""): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{64}$/i.test(hex))
    throw new Error("CONNECTOR_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function encryptConnectorSecret(value: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encryptionKeyBytes(keyHex), "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

async function decryptWithKey(value: string, keyHex: string): Promise<string> {
  const [version, ivText, ciphertextText] = value.split(":");
  if (version !== "v1" || !ivText || !ciphertextText)
    throw new Error("unsupported encrypted connector secret");
  const key = await crypto.subtle.importKey("raw", encryptionKeyBytes(keyHex), "AES-GCM", false, [
    "decrypt",
  ]);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivText) },
    key,
    base64ToBytes(ciphertextText),
  );
  return new TextDecoder().decode(clear);
}

export async function decryptConnectorSecretWithKeyring(
  value: string,
  currentKeyHex: string,
  previousKeyHex?: string,
): Promise<{ plaintext: string; key: "current" | "previous" }> {
  try {
    return { plaintext: await decryptWithKey(value, currentKeyHex), key: "current" };
  } catch (currentError) {
    if (!previousKeyHex || previousKeyHex === currentKeyHex) throw currentError;
    return { plaintext: await decryptWithKey(value, previousKeyHex), key: "previous" };
  }
}

export async function decryptConnectorSecret(
  value: string,
  keyHex: string,
  previousKeyHex?: string,
): Promise<string> {
  return (await decryptConnectorSecretWithKeyring(value, keyHex, previousKeyHex)).plaintext;
}

/** Decrypt with the current key, then the previous key. A previous-key hit is re-encrypted and written back. */
export async function decryptToken(
  value: string,
  currentKeyHex: string,
  previousKeyHex: string | undefined,
  writeBack: (ciphertext: string) => Promise<void>,
): Promise<string> {
  const decoded = await decryptConnectorSecretWithKeyring(value, currentKeyHex, previousKeyHex);
  if (decoded.key === "previous")
    await writeBack(await encryptConnectorSecret(decoded.plaintext, currentKeyHex));
  return decoded.plaintext;
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export class OAuthPkceClient {
  constructor(
    private readonly config: OAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createAuthorizationRequest(
    redirectUri: string,
  ): Promise<{ url: string; state: string; verifier: string }> {
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = base64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    );
    const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    for (const [key, value] of Object.entries(this.config.extraAuthorizationParams ?? {}))
      url.searchParams.set(key, value);
    return { url: url.toString(), state, verifier };
  }

  async exchangeCode(code: string, verifier: string, redirectUri: string): Promise<OAuthTokens> {
    return this.postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
  }

  async refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.postToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async postToken(fields: Record<string, string>): Promise<OAuthTokens> {
    const body = new URLSearchParams({ client_id: this.config.clientId, ...fields });
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);
    const response = await this.fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      instance_url?: string;
      error_description?: string;
    };
    if (!response.ok || !payload.access_token)
      throw new Error(
        payload.error_description ?? `OAuth token exchange failed (${response.status})`,
      );
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      scope: payload.scope,
      tokenType: payload.token_type,
      instanceUrl: payload.instance_url,
    };
  }
}

async function googleRequest(
  service: "gmail" | "calendar" | "drive",
  action: string,
  args: Record<string, unknown>,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const resource =
    service === "gmail"
      ? "https://gmail.googleapis.com/gmail/v1/users/me"
      : service === "calendar"
        ? "https://www.googleapis.com/calendar/v3"
        : "https://www.googleapis.com/drive/v3";
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  let method = "GET";
  let path = "";
  let body: unknown;
  const encode = (v: unknown) => encodeURIComponent(String(v ?? ""));

  if (service === "gmail") {
    if (action === "ListMessages")
      path = `/messages?maxResults=${Math.min(100, Number(args.maxResults ?? 20))}${args.query ? `&q=${encode(args.query)}` : ""}`;
    else if (action === "ReadMessage") path = `/messages/${encode(args.messageId)}?format=full`;
    else if (action === "ApplyLabel") {
      method = "POST";
      path = `/messages/${encode(args.messageId)}/modify`;
      body = { addLabelIds: Array.isArray(args.labelIds) ? args.labelIds : [], removeLabelIds: [] };
    } else if (action === "GetAttachment")
      path = `/messages/${encode(args.messageId)}/attachments/${encode(args.attachmentId)}`;
    else if (action === "SendMessage") {
      method = "POST";
      path = "/messages/send";
      const raw = [
        `To: ${String(args.to ?? "")}`,
        `Subject: ${String(args.subject ?? "")}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        String(args.body ?? ""),
      ].join("\r\n");
      body = { raw: base64Url(new TextEncoder().encode(raw)) };
    } else throw new Error(`unsupported Gmail action: ${action}`);
  } else if (service === "calendar") {
    const calendarId = encode(args.calendarId ?? "primary");
    if (action === "ListEvents") {
      const timeMin = typeof args.timeMin === "string" ? `&timeMin=${encode(args.timeMin)}` : "";
      path = `/calendars/${calendarId}/events?maxResults=${Math.min(250, Number(args.maxResults ?? 50))}&singleEvents=true&orderBy=startTime${timeMin}`;
    }
    else if (action === "CreateEvent") {
      method = "POST";
      path = `/calendars/${calendarId}/events`;
      body = args.event;
    } else if (action === "UpdateEvent") {
      method = "PATCH";
      path = `/calendars/${calendarId}/events/${encode(args.eventId)}`;
      body = args.event;
    } else if (action === "DeleteEvent") {
      method = "DELETE";
      path = `/calendars/${calendarId}/events/${encode(args.eventId)}`;
    } else if (action === "GetFreeBusy") {
      method = "POST";
      path = "/freeBusy";
      body = {
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        items: args.calendars ?? [{ id: calendarId }],
      };
    } else throw new Error(`unsupported Calendar action: ${action}`);
  } else if (service === "drive") {
    const fileId = encode(args.fileId);
    if (action === "ListFiles") {
      const query = new URLSearchParams();
      query.set("pageSize", String(Math.max(1, Math.min(100, Number(args.pageSize ?? 50)))));
      query.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)");
      if (args.query) query.set("q", String(args.query).slice(0, 1000));
      if (args.pageToken) query.set("pageToken", String(args.pageToken).slice(0, 2000));
      path = `/files?${query.toString()}`;
    } else if (action === "ReadFile") {
      if (!args.fileId) throw new Error("fileId is required");
      const metadataResponse = await fetchImpl(`${resource}/files/${fileId}?fields=mimeType`, {
        headers,
      });
      const metadataText = await metadataResponse.text();
      if (!metadataResponse.ok)
        throw new Error(
          `Drive ReadFile metadata failed (${metadataResponse.status}): ${metadataText.slice(0, 500)}`,
        );
      const metadata = JSON.parse(metadataText) as { mimeType?: string };
      const exportTypes: Record<string, string> = {
        "application/vnd.google-apps.document": "text/plain",
        "application/vnd.google-apps.presentation": "text/plain",
        "application/vnd.google-apps.spreadsheet": "text/csv",
      };
      const exportType = metadata.mimeType ? exportTypes[metadata.mimeType] : undefined;
      if (metadata.mimeType?.startsWith("application/vnd.google-apps.") && !exportType)
        throw new Error(`unsupported Google Workspace file type: ${metadata.mimeType}`);
      path = exportType
        ? `/files/${fileId}/export?mimeType=${encodeURIComponent(exportType)}`
        : `/files/${fileId}?alt=media`;
    } else if (action === "WriteFile") {
      const name = String(args.name ?? "")
        .trim()
        .slice(0, 255);
      const content = String(args.content ?? "");
      const mimeType = String(args.mimeType ?? "text/plain");
      if (!name) throw new Error("name is required");
      if (new TextEncoder().encode(content).byteLength > 1_000_000)
        throw new Error("file content exceeds 1 MB");
      if (!mimeType.startsWith("text/") && mimeType !== "application/json")
        throw new Error("WriteFile supports text and JSON files only");
      method = args.fileId ? "PATCH" : "POST";
      const metadata = args.fileId ? "" : JSON.stringify({ name, mimeType });
      const boundary = `agentos_${crypto.randomUUID().replaceAll("-", "")}`;
      const parts = [
        ...(metadata
          ? [
              `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
            ]
          : []),
        `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${content}\r\n`,
        `--${boundary}--`,
      ];
      const upload = args.fileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
        : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
      const response = await fetchImpl(upload, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: parts.join(""),
      });
      const text = await response.text();
      if (!response.ok)
        throw new Error(`Drive ${action} failed (${response.status}): ${text.slice(0, 500)}`);
      return text ? (JSON.parse(text) as unknown) : { ok: true };
    } else if (action === "ShareFile") {
      if (!args.fileId || !args.emailAddress)
        throw new Error("fileId and emailAddress are required");
      method = "POST";
      path = `/files/${fileId}/permissions?sendNotificationEmail=true`;
      body = {
        type: "user",
        role: args.role === "writer" ? "writer" : "reader",
        emailAddress: String(args.emailAddress).slice(0, 320),
      };
    } else throw new Error(`unsupported Drive action: ${action}`);
  }

  const response = await fetchImpl(`${resource}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (service === "drive" && action === "ReadFile") {
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Drive ${action} failed (${response.status}): ${error.slice(0, 500)}`);
    }
    if (
      !contentType.startsWith("text/") &&
      !contentType.includes("json") &&
      !contentType.includes("xml")
    )
      throw new Error(`unsupported Drive file content type: ${contentType || "unknown"}`);
    if (Number(response.headers.get("content-length") ?? 0) > 1_000_000)
      throw new Error("Drive file exceeds 1 MB read limit");
    if (!response.body) return { contentType, content: "" };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > 1_000_000) throw new Error("Drive file exceeds 1 MB read limit");
        chunks.push(value);
      }
    } catch (err) {
      await reader.cancel().catch(() => undefined);
      throw err;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { contentType, content: new TextDecoder().decode(bytes) };
  }
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${service} ${action} failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as unknown) : { ok: true };
}

/** v1 Google connector operations. Tokens are supplied by the caller after decryption. */
export class GoogleConnector {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  call(
    service: "gmail" | "calendar" | "drive",
    action: string,
    args: Record<string, unknown>,
    accessToken: string,
  ): Promise<unknown> {
    return googleRequest(service, action, args, accessToken, this.fetchImpl);
  }
}

export const OAUTH_START_SERVICES = [
  "gmail",
  "google-calendar",
  "google-drive",
  "microsoft",
  "salesforce",
] as const;

export type OAuthStartService = (typeof OAUTH_START_SERVICES)[number];

const MICROSOFT_SERVICES = [
  "onedrive",
  "outlook-mail",
  "outlook-calendar",
  "teams",
  "sharepoint",
] as const;

/** Microsoft Graph services share one stored OAuth connection. */
export function connectorCredentialService(service: string): string {
  return (MICROSOFT_SERVICES as readonly string[]).includes(service) ? "microsoft" : service;
}

export function oauthConfigFor(
  service: string,
  env: {
    googleClientId?: string;
    googleClientSecret?: string;
    microsoftClientId?: string;
    microsoftClientSecret?: string;
    salesforceClientId?: string;
    salesforceClientSecret?: string;
  },
): OAuthConfig {
  if (service === "gmail" || service === "google-calendar" || service === "google-drive") {
    if (!env.googleClientId) throw new Error("Google OAuth is not configured");
    return googleOAuthConfig(service, env.googleClientId, env.googleClientSecret);
  }
  if (service === "microsoft") {
    const clientId = env.microsoftClientId;
    if (!clientId) throw new Error("Microsoft OAuth is not configured");
    return {
      clientId,
      clientSecret: env.microsoftClientSecret,
      authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scopes: [
        "offline_access",
        "User.Read",
        "Files.ReadWrite",
        "Mail.ReadWrite",
        "Mail.Send",
        "Calendars.ReadWrite",
        "Team.ReadBasic.All",
        "Channel.ReadBasic.All",
        "ChannelMessage.Read.All",
        "ChannelMessage.Send",
        "Sites.ReadWrite.All",
      ],
      extraAuthorizationParams: { prompt: "select_account" },
    };
  }
  if (service === "salesforce") {
    // shortcut: PKCE authorization-code flow; use a secret-only web-server client if the connected app rejects code_challenge.
    const clientId = env.salesforceClientId;
    if (!clientId) throw new Error("Salesforce OAuth is not configured");
    return {
      clientId,
      clientSecret: env.salesforceClientSecret,
      authorizationUrl: "https://login.salesforce.com/services/oauth2/authorize",
      tokenUrl: "https://login.salesforce.com/services/oauth2/token",
      scopes: ["api", "refresh_token"],
    };
  }
  throw new Error("unsupported connector service");
}

export {
  callConnector,
  revokeConnectorToken,
} from "./services.ts";
