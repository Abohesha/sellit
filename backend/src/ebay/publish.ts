import type { Condition } from '../ai/schema';
import type { Marketplace } from '../config/marketplaces';
import { EbayApiError, type EbayEnvName, type EbayHttp } from './client';
import type { SellerSetup } from './setup';

export interface ListingContent {
  title: string;
  description: string;
  condition: Condition;
  aspects: Record<string, string[]>;
  /** Fixed price in the marketplace currency. */
  price: number;
  categoryId: string;
}

export interface PublishInput {
  itemId: string;
  marketplace: Marketplace;
  ebayEnv: EbayEnvName;
  accessToken: string;
  content: ListingContent;
  imageUrls: string[];
  setup: SellerSetup;
}

export interface PublishResult {
  sku: string;
  offerId: string;
  listingId: string;
  url: string;
  /** True when the listing already existed and nothing new was created. */
  alreadyPublished: boolean;
}

const EBAY_CONDITION: Record<Condition, string> = {
  NEW: 'NEW',
  LIKE_NEW: 'LIKE_NEW',
  VERY_GOOD: 'USED_VERY_GOOD',
  GOOD: 'USED_GOOD',
  ACCEPTABLE: 'USED_ACCEPTABLE',
};

/**
 * Deterministic per item: the SKU is the idempotency key. Re-running a publish for the same
 * item and marketplace finds the same inventory item and offer instead of creating new ones.
 * eBay SKUs are alphanumeric, so the UUID hyphens are dropped.
 */
export function skuForItem(itemId: string): string {
  return `SL${itemId.replace(/[^a-zA-Z0-9]/g, '')}`.slice(0, 50);
}

interface OfferSummary {
  offerId: string;
  status?: string;
  listing?: { listingId?: string };
}

export async function publishToEbay(api: EbayHttp, input: PublishInput): Promise<PublishResult> {
  const { marketplace, content, accessToken } = input;
  const sku = skuForItem(input.itemId);
  const common = { accessToken, contentLanguage: marketplace.contentLanguage, marketplaceId: marketplace.id };

  // 1. Inventory item (PUT is an upsert, so a retry is harmless).
  await api.request({
    method: 'PUT',
    path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    ...common,
    body: {
      product: {
        title: content.title,
        description: toHtml(content.description),
        aspects: content.aspects,
        imageUrls: input.imageUrls,
      },
      condition: EBAY_CONDITION[content.condition],
      availability: { shipToLocationAvailability: { quantity: 1 } },
    },
  });

  // 2. Offer: reuse the existing one for this SKU and marketplace if there is one.
  const offerBody = {
    sku,
    marketplaceId: marketplace.id,
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    categoryId: content.categoryId,
    listingDescription: toHtml(content.description),
    listingPolicies: {
      fulfillmentPolicyId: input.setup.fulfillmentPolicyId,
      paymentPolicyId: input.setup.paymentPolicyId,
      returnPolicyId: input.setup.returnPolicyId,
    },
    merchantLocationKey: input.setup.merchantLocationKey,
    pricingSummary: { price: { value: content.price.toFixed(2), currency: marketplace.currency } },
  };

  const existing = await findOffer(api, common, sku, marketplace.id);
  if (existing?.status === 'PUBLISHED' && existing.listing?.listingId) {
    return result(input, sku, existing.offerId, existing.listing.listingId, true);
  }

  let offerId: string;
  if (existing) {
    offerId = existing.offerId;
    await api.request({ method: 'PUT', path: `/sell/inventory/v1/offer/${offerId}`, ...common, body: offerBody });
  } else {
    const created = await api.request<{ offerId: string }>({
      method: 'POST',
      path: '/sell/inventory/v1/offer',
      ...common,
      body: offerBody,
    });
    if (!created.data?.offerId) throw new Error('eBay did not return an offerId');
    offerId = created.data.offerId;
  }

  // 3. Publish.
  const published = await api.request<{ listingId: string }>({
    method: 'POST',
    path: `/sell/inventory/v1/offer/${offerId}/publish`,
    ...common,
  });
  if (!published.data?.listingId) throw new Error('eBay did not return a listingId');
  return result(input, sku, offerId, published.data.listingId, false);
}

async function findOffer(
  api: EbayHttp,
  common: { accessToken: string; contentLanguage: string; marketplaceId: string },
  sku: string,
  marketplaceId: string,
): Promise<OfferSummary | undefined> {
  try {
    const res = await api.request<{ offers?: OfferSummary[] }>({
      method: 'GET',
      path: '/sell/inventory/v1/offer',
      query: { sku, marketplace_id: marketplaceId },
      ...common,
    });
    return res.data?.offers?.[0];
  } catch (err) {
    // eBay answers 404 when the SKU has no offers yet.
    if (err instanceof EbayApiError && err.status === 404) return undefined;
    throw err;
  }
}

function result(input: PublishInput, sku: string, offerId: string, listingId: string, alreadyPublished: boolean): PublishResult {
  const domain =
    input.ebayEnv === 'sandbox' ? input.marketplace.siteDomain.replace('www.', 'www.sandbox.') : input.marketplace.siteDomain;
  return { sku, offerId, listingId, url: `https://${domain}/itm/${listingId}`, alreadyPublished };
}

function toHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
