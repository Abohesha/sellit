import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import type { Deps } from './deps';
import type { Queues } from './queue';

const env = loadEnv({
  PUBLIC_BASE_URL: 'https://api.example.test',
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  STATE_SIGNING_SECRET: 's'.repeat(32),
  EBAY_CLIENT_ID: 'id',
  EBAY_CLIENT_SECRET: 'secret',
  EBAY_RU_NAME: 'ru',
  EBAY_VERIFICATION_TOKEN: 'v'.repeat(40),
  EBAY_NOTIFICATION_ENDPOINT: 'https://api.example.test/ebay/notifications',
  ENABLED_MARKETPLACES: 'EBAY_DE',
});

const ITEM_ID = '3f2c9a6e-1b7d-4c1a-9a55-0f1d2e3c4b5a';

function setup(draft: unknown) {
  const publishAdd = vi.fn();
  const repo = {
    ensureUser: vi.fn(),
    getItem: vi.fn(async () => ({ id: ITEM_ID, userId: 'u1', status: 'draft', createdAt: new Date() })),
    getDraft: vi.fn(async () => draft),
    getEbayConnection: vi.fn(async () => ({ id: 'c1' })),
    upsertJob: vi.fn(),
  };
  const deps = {
    env,
    repo,
    auth: { verify: async (t: string) => (t === 'good' ? 'u1' : null) },
  } as unknown as Deps;
  const queues = { publish: { getJob: vi.fn(async () => undefined), add: publishAdd } } as unknown as Queues;
  return { app: buildApp(deps, queues), publishAdd };
}

const auth = { authorization: 'Bearer good' };

describe('API', () => {
  it('rejects requests without a valid token', async () => {
    const { app } = setup(null);
    expect((await app.inject({ method: 'GET', url: '/marketplaces' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/marketplaces', headers: { authorization: 'Bearer bad' } })).statusCode).toBe(401);
  });

  it('only lists enabled marketplaces', async () => {
    const { app } = setup(null);
    const res = await app.inject({ method: 'GET', url: '/marketplaces', headers: auth });
    expect(res.json()).toEqual([{ id: 'EBAY_DE', country: 'DE', currency: 'EUR' }]);
  });

  it('refuses to publish a draft the user has not reviewed', async () => {
    const { app, publishAdd } = setup({ reviewedAt: null });
    const res = await app.inject({
      method: 'POST',
      url: `/items/${ITEM_ID}/publish`,
      headers: auth,
      payload: { marketplaceId: 'EBAY_DE' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'review_required' });
    expect(publishAdd).not.toHaveBeenCalled();
  });

  it('enqueues one publish job with a deterministic id once reviewed', async () => {
    const { app, publishAdd } = setup({ reviewedAt: new Date() });
    const res = await app.inject({
      method: 'POST',
      url: `/items/${ITEM_ID}/publish`,
      headers: auth,
      payload: { marketplaceId: 'EBAY_DE' },
    });
    expect(res.statusCode).toBe(202);
    expect(publishAdd.mock.calls[0]![2]).toEqual({ jobId: `publish_${ITEM_ID}_EBAY_DE` });
  });

  it('rejects marketplaces that are not enabled', async () => {
    const { app } = setup({ reviewedAt: new Date() });
    const res = await app.inject({
      method: 'POST',
      url: `/items/${ITEM_ID}/publish`,
      headers: auth,
      payload: { marketplaceId: 'EBAY_GB' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers the eBay notification challenge', async () => {
    const { app } = setup(null);
    const res = await app.inject({ method: 'GET', url: '/ebay/notifications?challenge_code=abc' });
    const expected = createHash('sha256')
      .update('abc')
      .update(env.EBAY_VERIFICATION_TOKEN!)
      .update(env.EBAY_NOTIFICATION_ENDPOINT!)
      .digest('hex');
    expect(res.json()).toEqual({ challengeResponse: expected });
  });
});
