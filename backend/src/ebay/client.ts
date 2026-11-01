export type EbayEnvName = 'sandbox' | 'production';

export const EBAY_HOSTS: Record<EbayEnvName, { api: string; auth: string }> = {
  sandbox: { api: 'https://api.sandbox.ebay.com', auth: 'https://auth.sandbox.ebay.com' },
  production: { api: 'https://api.ebay.com', auth: 'https://auth.ebay.com' },
};

export class EbayApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`eBay API error ${status}`);
  }
}

export interface EbayRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  accessToken: string;
  query?: Record<string, string>;
  body?: unknown;
  contentLanguage?: string;
  marketplaceId?: string;
}

export interface EbayResponse<T = unknown> {
  status: number;
  data: T | undefined;
}

export interface EbayHttp {
  request<T = unknown>(req: EbayRequest): Promise<EbayResponse<T>>;
}

export function createEbayHttp(env: EbayEnvName, fetchImpl: typeof fetch = fetch): EbayHttp {
  const base = EBAY_HOSTS[env].api;
  return {
    async request<T>(req: EbayRequest): Promise<EbayResponse<T>> {
      const url = new URL(base + req.path);
      for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${req.accessToken}`,
        Accept: 'application/json',
      };
      if (req.body !== undefined) headers['Content-Type'] = 'application/json';
      if (req.contentLanguage) headers['Content-Language'] = req.contentLanguage;
      if (req.marketplaceId) headers['X-EBAY-C-MARKETPLACE-ID'] = req.marketplaceId;

      const res = await fetchImpl(url, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
      const text = await res.text();
      let data: unknown;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) throw new EbayApiError(res.status, data);
      return { status: res.status, data: data as T | undefined };
    },
  };
}
