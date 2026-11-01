import type { Marketplace } from '../config/marketplaces';
import { buildRetryPrompt, buildSystemPrompt, buildUserPrompt } from './prompt';
import type { VisionImage, VisionProvider } from './provider';
import { parseAiListing, type AiListing } from './schema';

export interface Pricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export interface DraftResult {
  draft: AiListing;
  /** Raw model text of the accepted attempt (stored as ListingDraft raw AI output). */
  rawText: string;
  model: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  /** Cost across ALL attempts, including rejected ones. */
  costUsd: number;
}

export class DraftGenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly costUsd: number,
  ) {
    super(message);
  }
}

export async function generateDraft(
  provider: VisionProvider,
  input: { images: VisionImage[]; marketplace: Marketplace; pricing: Pricing; maxAttempts: number },
): Promise<DraftResult> {
  const system = buildSystemPrompt(input.marketplace);
  const baseUser = buildUserPrompt(input.images);
  let user = baseUser;
  let inputTokens = 0;
  let outputTokens = 0;
  let lastError = 'unknown error';

  const cost = () =>
    (inputTokens * input.pricing.inputUsdPerMTok + outputTokens * input.pricing.outputUsdPerMTok) / 1_000_000;

  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    const res = await provider.complete({ system, user, images: input.images });
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    try {
      const draft = parseAiListing(res.text);
      return {
        draft,
        rawText: res.text,
        model: res.model,
        attempts: attempt,
        inputTokens,
        outputTokens,
        costUsd: cost(),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      user = buildRetryPrompt(baseUser, lastError);
    }
  }
  throw new DraftGenerationError(
    `AI returned invalid output after ${input.maxAttempts} attempts: ${lastError}`,
    input.maxAttempts,
    cost(),
  );
}
