import { EBAY_HOSTS, EbayApiError, type EbayEnvName } from './client';

export interface EbayOAuthConfig {
  env: EbayEnvName;
  clientId: string;
  clientSecret: string;
  ruName: string;
}

export const EBAY_USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
];

export const EBAY_APP_SCOPE = 'https://api.ebay.com/oauth/api_scope';

export interface UserTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date | null;
}

export function buildConsentUrl(cfg: EbayOAuthConfig, state: string): string {
  const url = new URL(`${EBAY_HOSTS[cfg.env].auth}/oauth2/authorize`);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', cfg.ruName);
  url.searchParams.set('scope', EBAY_USER_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeAuthorizationCode(
  cfg: EbayOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UserTokens> {
  const json = await tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.ruName }, fetchImpl);
  if (!json.refresh_token) throw new Error('eBay did not return a refresh token');
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    refreshTokenExpiresAt: json.refresh_token_expires_in ? new Date(Date.now() + json.refresh_token_expires_in * 1000) : null,
  };
}

export async function refreshAccessToken(
  cfg: EbayOAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const json = await tokenRequest(
    cfg,
    { grant_type: 'refresh_token', refresh_token: refreshToken, scope: EBAY_USER_SCOPES.join(' ') },
    fetchImpl,
  );
  return json.access_token;
}

/** Application-level token (client credentials) for public APIs such as Taxonomy. */
export async function getApplicationToken(cfg: EbayOAuthConfig, fetchImpl: typeof fetch = fetch): Promise<string> {
  const json = await tokenRequest(cfg, { grant_type: 'client_credentials', scope: EBAY_APP_SCOPE }, fetchImpl);
  return json.access_token;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

async function tokenRequest(cfg: EbayOAuthConfig, form: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetchImpl(`${EBAY_HOSTS[cfg.env].api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body: unknown = await res.json().catch(() => undefined);
  // Never include the request (it contains tokens/secrets) in the error.
  if (!res.ok) throw new EbayApiError(res.status, body);
  return body as TokenResponse;
}
