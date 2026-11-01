import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type PhotoKind = 'front' | 'back' | 'label' | 'flaw' | 'extra';
export type Condition = 'NEW' | 'LIKE_NEW' | 'VERY_GOOD' | 'GOOD' | 'ACCEPTABLE';
export const CONDITIONS: Condition[] = ['NEW', 'LIKE_NEW', 'VERY_GOOD', 'GOOD', 'ACCEPTABLE'];

export interface Uncertain<T> {
  value: T | null;
  confidence: number;
  source: 'tag' | 'photo' | 'inferred' | 'unknown';
}

export interface AiListing {
  title: string;
  description: string;
  category: Uncertain<string>;
  brand: Uncertain<string>;
  size: Uncertain<string>;
  colour: Uncertain<string>;
  condition: Uncertain<Condition>;
  priceRange: { min: number; max: number; currency: string };
  itemSpecifics: Record<string, string>;
  uncertaintyNotes: string[];
}

export interface Mapping {
  candidates: { categoryId: string; categoryName: string }[];
  categoryId: string;
  categoryName: string;
  requiredAspects: string[];
}

export interface Edits {
  title: string;
  description: string;
  condition: Condition;
  categoryId: string;
  brand: string | null;
  size: string | null;
  colour: string | null;
  aspects: Record<string, string>;
  price: number;
}

export interface Marketplace {
  id: string;
  country: string;
  currency: string;
}

export interface JobInfo {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  error: string | null;
}

export interface ItemView {
  item: { id: string; status: string };
  draft: { marketplaceId: string; ai: AiListing; mapping: Mapping | null; edits: Edits | null } | null;
  draftJob: JobInfo | null;
  publishJob: JobInfo | null;
  published: { url: string; ebayListingId: string } | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, err.error ?? 'request_failed');
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  marketplaces: () => call<Marketplace[]>('GET', '/marketplaces'),
  consent: (privacyPolicyVersion: string, aiProcessing: boolean) =>
    call<void>('POST', '/me/consent', { privacyPolicyVersion, aiProcessing }),
  createItem: () => call<{ id: string }>('POST', '/items'),
  getItem: (id: string, marketplaceId?: string) =>
    call<ItemView>('GET', `/items/${id}${marketplaceId ? `?marketplaceId=${marketplaceId}` : ''}`),
  requestDraft: (itemId: string, marketplaceId: string) =>
    call<{ jobId: string }>('POST', `/items/${itemId}/draft`, { marketplaceId, requestId: Crypto.randomUUID() }),
  review: (itemId: string, edits: Edits) => call<void>('PUT', `/items/${itemId}/review`, edits),
  publish: (itemId: string, marketplaceId: string) => call<{ jobId: string }>('POST', `/items/${itemId}/publish`, { marketplaceId }),
  ebayConnections: () => call<{ marketplaceId: string; connected: boolean }[]>('GET', '/ebay/connections'),
  ebayConnectUrl: (marketplaceId: string) => call<{ url: string }>('GET', `/ebay/connect?marketplaceId=${marketplaceId}`),
  exportMyData: () => call<unknown>('GET', '/me/export'),
  deleteMyAccount: () => call<void>('DELETE', '/me'),

  /** Asks the backend for a signed URL, then uploads straight to storage. The photo never touches our backend. */
  async uploadPhoto(itemId: string, kind: PhotoKind, fileUri: string): Promise<void> {
    const signed = await call<{ upload: { path: string; token: string; bucket: string } }>('POST', `/items/${itemId}/photos`, {
      kind,
      contentType: 'image/jpeg',
    });
    const blob = await (await fetch(fileUri)).blob();
    const { error } = await supabase.storage
      .from(signed.upload.bucket)
      .uploadToSignedUrl(signed.upload.path, signed.upload.token, blob, { contentType: 'image/jpeg' });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
  },
};

export async function pollUntil<T>(fn: () => Promise<T>, done: (v: T) => boolean, intervalMs = 2000, timeoutMs = 120_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (done(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for the server');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
