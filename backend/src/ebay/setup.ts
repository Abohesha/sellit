import type { EbayHttp } from './client';

export interface SellerSetup {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string;
}

export class SellerSetupIncompleteError extends Error {
  constructor(readonly missing: string[]) {
    super(`Seller setup incomplete on eBay: missing ${missing.join(', ')}`);
  }
}

/**
 * Looks up the seller's existing business policies and inventory location for a marketplace.
 * Policies are per marketplace, so each lookup passes marketplace_id.
 * Creating defaults is a later step: for now an incomplete account is reported so the app can guide the user.
 */
export async function findSellerSetup(api: EbayHttp, accessToken: string, marketplaceId: string): Promise<SellerSetup> {
  const query = { marketplace_id: marketplaceId };
  const get = async <T>(path: string, q?: Record<string, string>) =>
    (await api.request<T>({ method: 'GET', path, accessToken, query: q })).data;

  const [fulfillment, payment, ret, locations] = await Promise.all([
    get<{ fulfillmentPolicies?: { fulfillmentPolicyId: string }[] }>('/sell/account/v1/fulfillment_policy', query),
    get<{ paymentPolicies?: { paymentPolicyId: string }[] }>('/sell/account/v1/payment_policy', query),
    get<{ returnPolicies?: { returnPolicyId: string }[] }>('/sell/account/v1/return_policy', query),
    get<{ locations?: { merchantLocationKey: string }[] }>('/sell/inventory/v1/location'),
  ]);

  const fulfillmentPolicyId = fulfillment?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
  const paymentPolicyId = payment?.paymentPolicies?.[0]?.paymentPolicyId;
  const returnPolicyId = ret?.returnPolicies?.[0]?.returnPolicyId;
  const merchantLocationKey = locations?.locations?.[0]?.merchantLocationKey;

  const missing: string[] = [];
  if (!fulfillmentPolicyId) missing.push('shipping policy');
  if (!paymentPolicyId) missing.push('payment policy');
  if (!returnPolicyId) missing.push('return policy');
  if (!merchantLocationKey) missing.push('inventory location');
  if (missing.length || !fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId || !merchantLocationKey) {
    throw new SellerSetupIncompleteError(missing);
  }
  return { fulfillmentPolicyId, paymentPolicyId, returnPolicyId, merchantLocationKey };
}
