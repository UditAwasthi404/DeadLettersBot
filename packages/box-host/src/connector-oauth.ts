import { type OAuthConfig, oauthConfigFor } from "@agentOS/connectors";

export function oauthConfigFromEnv(service: string): OAuthConfig {
  return oauthConfigFor(service, {
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    microsoftClientId: process.env.MICROSOFT_OAUTH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID,
    microsoftClientSecret:
      process.env.MICROSOFT_OAUTH_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET,
    salesforceClientId: process.env.SALESFORCE_OAUTH_CLIENT_ID || process.env.SALESFORCE_CLIENT_ID,
    salesforceClientSecret:
      process.env.SALESFORCE_OAUTH_CLIENT_SECRET || process.env.SALESFORCE_CLIENT_SECRET,
  });
}
