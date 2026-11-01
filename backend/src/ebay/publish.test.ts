import { describe, expect, it } from 'vitest';
import { ALL_MARKETPLACES } from '../config/marketplaces';
import { buildAspects, missingRequiredAspects } from './aspects';
import { EbayApiError, type EbayHttp, type EbayRequest } from './client';
import { TokenCipher, signState, verifyState } from './crypto';
import { publishToEbay, skuForItem, type PublishInput } from './publish';

const marketplace = ALL_MARKETPLACES.find((m) => m.id === 'EBAY_DE')!;

const input: PublishInput = {
  itemId: '3f2c9a6e-1b7d-4c1a-9a55-0f1d2e3c4b5a',
  marketplace,
  ebayEnv: 'sandbox',
  accessToken: 'tok',
  content: {
    title: 'Nike Air Max 90 Gr. 43',
    description: 'Gut erhalten & sauber.\n\nNichtraucherhaushalt.',
    condition: 'GOOD',
    aspects: { Marke: ['Nike'] },
    price: 39.5,
    categoryId: '15709',
  },
  imageUrls: ['https://img.test/1.jpg'],
  setup: { fulfillmentPolicyId: 'f1', paymentPolicyId: 'p1', returnPolicyId: 'r1', merchantLocationKey: 'home' },
};

type Handler = (req: EbayRequest) => unknown;

function fakeEbay(handler: Handler): EbayHttp & { calls: EbayRequest[] } {
  const calls: EbayRequest[] = [];
  return {
    calls,
    async request<T>(req: EbayRequest) {
      calls.push(req);
      return { status: 200, data: handler(req) as T };
    },
  };
}

const summary = (api: { calls: EbayRequest[] }) => api.calls.map((c) => `${c.method} ${c.path}`);

describe('publishToEbay', () => {
  it('creates inventory item, offer, then publishes', async () => {
    const api = fakeEbay((req) => {
      if (req.method === 'GET') throw new EbayApiError(404, { errors: [{ errorId: 25713 }] });
      if (req.path.endsWith('/publish')) return { listingId: 'L1' };
      if (req.method === 'POST') return { offerId: 'O1' };
      return undefined;
    });
    const res = await publishToEbay(api, input);
    const sku = skuForItem(input.itemId);
    expect(summary(api)).toEqual([
      `PUT /sell/inventory/v1/inventory_item/${sku}`,
      'GET /sell/inventory/v1/offer',
      'POST /sell/inventory/v1/offer',
      'POST /sell/inventory/v1/offer/O1/publish',
    ]);
    expect(res).toMatchObject({ listingId: 'L1', offerId: 'O1', alreadyPublished: false });
    expect(res.url).toBe('https://www.sandbox.ebay.de/itm/L1');

    const offer = api.calls[2]!.body as { pricingSummary: { price: { value: string; currency: string } }; marketplaceId: string };
    expect(offer.pricingSummary.price).toEqual({ value: '39.50', currency: 'EUR' });
    expect(offer.marketplaceId).toBe('EBAY_DE');
    const inv = api.calls[0]!.body as { product: { description: string }; condition: string };
    expect(inv.condition).toBe('USED_GOOD');
    expect(inv.product.description).toContain('&amp;');
  });

  it('retry after success creates nothing new', async () => {
    const api = fakeEbay((req) =>
      req.method === 'GET' ? { offers: [{ offerId: 'O1', status: 'PUBLISHED', listing: { listingId: 'L1' } }] } : undefined,
    );
    const res = await publishToEbay(api, input);
    expect(res).toMatchObject({ listingId: 'L1', alreadyPublished: true });
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('retry after a crash between offer and publish reuses the offer', async () => {
    const api = fakeEbay((req) => {
      if (req.method === 'GET') return { offers: [{ offerId: 'O1', status: 'UNPUBLISHED' }] };
      if (req.path.endsWith('/publish')) return { listingId: 'L9' };
      return undefined;
    });
    const res = await publishToEbay(api, input);
    expect(res.listingId).toBe('L9');
    expect(summary(api)).not.toContain('POST /sell/inventory/v1/offer');
    expect(summary(api)).toContain('PUT /sell/inventory/v1/offer/O1');
  });

  it('propagates non-404 errors', async () => {
    const api = fakeEbay((req) => {
      if (req.method === 'GET') throw new EbayApiError(500, {});
      return undefined;
    });
    await expect(publishToEbay(api, input)).rejects.toBeInstanceOf(EbayApiError);
  });

  it('SKU is stable, alphanumeric and within 50 chars', () => {
    const sku = skuForItem(input.itemId);
    expect(sku).toBe(skuForItem(input.itemId));
    expect(sku).toMatch(/^[A-Za-z0-9]{1,50}$/);
  });
});

describe('aspects', () => {
  it('uses localised aspect names from marketplace config', () => {
    const aspects = buildAspects(marketplace, { brand: 'Nike', size: '43', colour: 'Weiß', extra: { Material: 'Leder' } });
    expect(aspects).toEqual({ Material: ['Leder'], Marke: ['Nike'], 'Größe': ['43'], Farbe: ['Weiß'] });
  });

  it('reports missing required aspects case-insensitively', () => {
    expect(missingRequiredAspects(['Marke', 'Größe'], { marke: ['Nike'] })).toEqual(['Größe']);
  });
});

describe('crypto', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('round-trips and never stores plaintext', () => {
    const cipher = new TokenCipher(key);
    const enc = cipher.encrypt('v^1.1#refresh');
    expect(enc).not.toContain('refresh');
    expect(cipher.decrypt(enc)).toBe('v^1.1#refresh');
    expect(cipher.encrypt('v^1.1#refresh')).not.toBe(enc);
  });

  it('rejects tampered ciphertext and short keys', () => {
    const cipher = new TokenCipher(key);
    const enc = cipher.encrypt('secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered!').toString('base64url');
    expect(() => cipher.decrypt(parts.join('.'))).toThrow();
    expect(() => new TokenCipher(Buffer.alloc(8).toString('base64'))).toThrow();
  });

  it('signed state verifies, expires and detects tampering', () => {
    const t = signState('s'.repeat(20), { userId: 'u1', marketplaceId: 'EBAY_DE' }, 1000, 1_000);
    expect(verifyState('s'.repeat(20), t, 1_500)).toEqual({ userId: 'u1', marketplaceId: 'EBAY_DE' });
    expect(verifyState('s'.repeat(20), t, 5_000)).toBeNull();
    expect(verifyState('x'.repeat(20), t, 1_500)).toBeNull();
    expect(verifyState('s'.repeat(20), 'a.b', 1_500)).toBeNull();
  });
});
