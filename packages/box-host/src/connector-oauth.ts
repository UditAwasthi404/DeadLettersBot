import { type OAuthConfig, oauthConfigFor } from "@agentOS/connectors";

function clean(value: string | undefined): string | undefined {
  const cleaned = value?.replaceAll("\r", "").trim();
  return cleaned || undefined;
}

export function configuredOAuthRedirectUri(requestUrl?: string): string {
  const configured =
    clean(process.env.OAUTH_REDIRECT_URI) || clean(process.env.GOOGLE_OAUTH_REDIRECT_URI);
  if (configured) return configured;
  if (requestUrl) {
    try {
      return `${new URL(requestUrl).origin}/v1/connectors/oauth/callback`;
    } catch {
      // Fall through to the loopback address Compose publishes.
    }
  }
  return "http://127.0.0.1:8787/v1/connectors/oauth/callback";
}

export function microsoftOAuthClient(): { clientId?: string; clientSecret?: string } {
  return {
    clientId:
      clean(process.env.MICROSOFT_OAUTH_CLIENT_ID) || clean(process.env.MICROSOFT_CLIENT_ID),
    clientSecret:
      clean(process.env.MICROSOFT_OAUTH_CLIENT_SECRET) ||
      clean(process.env.MICROSOFT_CLIENT_SECRET),
  };
}

export function oauthConfigFromEnv(service: string): OAuthConfig {
  return oauthConfigFor(service, {
    googleClientId: clean(process.env.GOOGLE_OAUTH_CLIENT_ID),
    googleClientSecret: clean(process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    microsoftClientId:
      clean(process.env.MICROSOFT_OAUTH_CLIENT_ID) || clean(process.env.MICROSOFT_CLIENT_ID),
    microsoftClientSecret:
      clean(process.env.MICROSOFT_OAUTH_CLIENT_SECRET) ||
      clean(process.env.MICROSOFT_CLIENT_SECRET),
    salesforceClientId:
      clean(process.env.SALESFORCE_OAUTH_CLIENT_ID) || clean(process.env.SALESFORCE_CLIENT_ID),
    salesforceClientSecret:
      clean(process.env.SALESFORCE_OAUTH_CLIENT_SECRET) ||
      clean(process.env.SALESFORCE_CLIENT_SECRET),
    microsoftExtraScopes: clean(process.env.MICROSOFT_OAUTH_EXTRA_SCOPES),
  });
}
