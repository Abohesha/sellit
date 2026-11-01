import { generateDraft } from '../ai/generateDraft';
import { getMarketplace } from '../config/marketplaces';
import type { Deps } from '../deps';
import { getApplicationToken } from '../ebay/oauth';
import { mapCategory, type CategoryMapping } from '../ebay/taxonomy';
import type { DraftJobData } from '../queue';
import { NonRetryableError } from './errors';

const PHOTO_URL_TTL_SECONDS = 15 * 60;

export async function processDraftJob(deps: Deps, data: DraftJobData, log: (msg: string) => void = () => {}) {
  const { env, repo } = deps;
  const marketplace = getMarketplace(data.marketplaceId, env.ENABLED_MARKETPLACES);

  const photos = await repo.listPhotos(data.itemId);
  if (photos.length === 0) throw new NonRetryableError('Item has no photos');

  const urls = await deps.storage.createSignedReadUrls(
    photos.map((p) => p.storagePath),
    PHOTO_URL_TTL_SECONDS,
  );
  const images = photos.map((p, i) => ({ kind: p.kind, url: urls[i]! }));

  const result = await generateDraft(deps.ai, {
    images,
    marketplace,
    pricing: { inputUsdPerMTok: env.AI_PRICE_INPUT_USD_PER_MTOK, outputUsdPerMTok: env.AI_PRICE_OUTPUT_USD_PER_MTOK },
    maxAttempts: env.AI_MAX_ATTEMPTS,
  });
  log(`ai draft ok item=${data.itemId} attempts=${result.attempts} costUsd=${result.costUsd.toFixed(6)}`);

  // Category mapping is best effort: the user can still pick a category in the review editor.
  let mapping: CategoryMapping | null = null;
  try {
    const appToken = await getApplicationToken(deps.oauth);
    mapping = await mapCategory(deps.ebayHttp, appToken, marketplace, result.draft.category.value ?? result.draft.title);
  } catch (err) {
    log(`category mapping skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  await repo.saveDraft({
    itemId: data.itemId,
    marketplaceId: data.marketplaceId,
    rawAiOutput: result.rawText,
    aiListing: result.draft,
    mapping,
    model: result.model,
    attempts: result.attempts,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  });
}
