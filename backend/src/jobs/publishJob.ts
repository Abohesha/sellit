import { getMarketplace } from '../config/marketplaces';
import type { Deps } from '../deps';
import { buildAspects, missingRequiredAspects } from '../ebay/aspects';
import { refreshAccessToken } from '../ebay/oauth';
import { publishToEbay } from '../ebay/publish';
import { SellerSetupIncompleteError, findSellerSetup, type SellerSetup } from '../ebay/setup';
import type { PublishJobData } from '../queue';
import { NonRetryableError } from './errors';

const PHOTO_URL_TTL_SECONDS = 60 * 60;

export async function processPublishJob(deps: Deps, data: PublishJobData, log: (msg: string) => void = () => {}) {
  const { env, repo } = deps;
  const marketplace = getMarketplace(data.marketplaceId, env.ENABLED_MARKETPLACES);

  // Already done by an earlier attempt: nothing to create.
  const done = await repo.getPublishedListing(data.itemId, data.marketplaceId);
  if (done) {
    await repo.setItemStatus(data.itemId, 'published');
    return;
  }

  const draft = await repo.getDraft(data.itemId);
  if (!draft?.edits || !draft.reviewedAt) throw new NonRetryableError('Draft has not been reviewed by the user');
  const edits = draft.edits;

  const connection = await repo.getEbayConnection(data.userId, data.marketplaceId);
  if (!connection) throw new NonRetryableError(`eBay account not connected for ${data.marketplaceId}`);

  const accessToken = await refreshAccessToken(deps.oauth, deps.cipher.decrypt(connection.refreshTokenEnc));

  let setup: SellerSetup;
  const { fulfillmentPolicyId, paymentPolicyId, returnPolicyId, merchantLocationKey } = connection;
  if (fulfillmentPolicyId && paymentPolicyId && returnPolicyId && merchantLocationKey) {
    setup = { fulfillmentPolicyId, paymentPolicyId, returnPolicyId, merchantLocationKey };
  } else {
    try {
      setup = await findSellerSetup(deps.ebayHttp, accessToken, marketplace.id);
    } catch (err) {
      if (err instanceof SellerSetupIncompleteError) throw new NonRetryableError(err.message);
      throw err;
    }
    await repo.saveSellerSetup(connection.id, setup);
  }

  const aspects = buildAspects(marketplace, {
    brand: edits.brand,
    size: edits.size,
    colour: edits.colour,
    extra: edits.aspects,
  });
  if (draft.mapping && draft.mapping.categoryId === edits.categoryId) {
    const missing = missingRequiredAspects(draft.mapping.requiredAspects, aspects);
    if (missing.length) throw new NonRetryableError(`Missing required item specifics: ${missing.join(', ')}`);
  }

  const photos = await repo.listPhotos(data.itemId);
  const imageUrls = await deps.storage.createSignedReadUrls(
    photos.map((p) => p.storagePath),
    PHOTO_URL_TTL_SECONDS,
  );

  const result = await publishToEbay(deps.ebayHttp, {
    itemId: data.itemId,
    marketplace,
    ebayEnv: env.EBAY_ENV,
    accessToken,
    content: {
      title: edits.title,
      description: edits.description,
      condition: edits.condition,
      aspects,
      price: edits.price,
      categoryId: edits.categoryId,
    },
    imageUrls,
    setup,
  });

  await repo.upsertPublishedListing({
    itemId: data.itemId,
    marketplaceId: data.marketplaceId,
    sku: result.sku,
    offerId: result.offerId,
    ebayListingId: result.listingId,
    url: result.url,
    status: 'active',
  });
  await repo.setItemStatus(data.itemId, 'published');
  log(`published item=${data.itemId} marketplace=${data.marketplaceId} listing=${result.listingId} reused=${result.alreadyPublished}`);
}
