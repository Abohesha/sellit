import { describe, expect, it } from 'vitest';
import { ALL_MARKETPLACES } from '../config/marketplaces';
import { generateDraft, DraftGenerationError } from './generateDraft';
import type { VisionProvider, VisionRequest, VisionResult } from './provider';
import { parseAiListing } from './schema';

const marketplace = ALL_MARKETPLACES[0]!;
const pricing = { inputUsdPerMTok: 3, outputUsdPerMTok: 15 };
const images = [{ kind: 'front' as const, url: 'https://example.test/a.jpg' }];

const valid = {
  title: 'Nike Air Max 90 trainers UK 9',
  description: 'Worn a few times. Light creasing on toe box.',
  category: { value: "men's trainers", confidence: 0.9, source: 'photo' },
  brand: { value: 'Nike', confidence: 0.95, source: 'tag' },
  size: { value: 'UK 9', confidence: 0.9, source: 'tag' },
  colour: { value: 'White', confidence: 0.8, source: 'photo' },
  condition: { value: 'GOOD', confidence: 0.6, source: 'inferred' },
  priceRange: { min: 30, max: 45, currency: 'GBP' },
  itemSpecifics: { Material: 'Leather' },
  uncertaintyNotes: ['Check sole wear'],
};

function scripted(replies: string[]): VisionProvider & { calls: VisionRequest[] } {
  const calls: VisionRequest[] = [];
  return {
    name: 'fake',
    calls,
    async complete(req): Promise<VisionResult> {
      calls.push(req);
      const text = replies[calls.length - 1] ?? replies[replies.length - 1]!;
      return { text, model: 'fake-1', inputTokens: 1000, outputTokens: 200 };
    },
  };
}

describe('parseAiListing', () => {
  it('accepts valid JSON, including inside code fences', () => {
    const fenced = '```json\n' + JSON.stringify(valid) + '\n```';
    expect(parseAiListing(fenced).title).toBe(valid.title);
  });

  it('rejects unknown keys, bad enums and inverted price ranges', () => {
    expect(() => parseAiListing(JSON.stringify({ ...valid, extra: 1 }))).toThrow(/schema/);
    expect(() =>
      parseAiListing(JSON.stringify({ ...valid, condition: { value: 'MINT', confidence: 1, source: 'photo' } })),
    ).toThrow(/schema/);
    expect(() =>
      parseAiListing(JSON.stringify({ ...valid, priceRange: { min: 50, max: 10, currency: 'GBP' } })),
    ).toThrow(/priceRange/);
  });

  it('rejects titles over 80 characters and non-JSON text', () => {
    expect(() => parseAiListing(JSON.stringify({ ...valid, title: 'x'.repeat(81) }))).toThrow(/title/);
    expect(() => parseAiListing('sorry, I cannot help')).toThrow(/no JSON/);
  });

  it('allows null values with zero confidence for unknown fields', () => {
    const draft = parseAiListing(
      JSON.stringify({ ...valid, brand: { value: null, confidence: 0, source: 'unknown' } }),
    );
    expect(draft.brand.value).toBeNull();
  });
});

describe('generateDraft', () => {
  it('returns the first valid attempt and tracks cost', async () => {
    const provider = scripted([JSON.stringify(valid)]);
    const res = await generateDraft(provider, { images, marketplace, pricing, maxAttempts: 3 });
    expect(res.attempts).toBe(1);
    expect(res.costUsd).toBeCloseTo((1000 * 3 + 200 * 15) / 1e6);
  });

  it('retries with the validation error and counts the cost of rejected attempts', async () => {
    const provider = scripted(['not json', JSON.stringify(valid)]);
    const res = await generateDraft(provider, { images, marketplace, pricing, maxAttempts: 3 });
    expect(res.attempts).toBe(2);
    expect(provider.calls[1]!.user).toContain('previous reply was rejected');
    expect(res.inputTokens).toBe(2000);
    expect(res.costUsd).toBeCloseTo((2000 * 3 + 400 * 15) / 1e6);
  });

  it('fails after max attempts and still reports the spend', async () => {
    const provider = scripted(['nope']);
    const err = await generateDraft(provider, { images, marketplace, pricing, maxAttempts: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(DraftGenerationError);
    expect(err.attempts).toBe(2);
    expect(err.costUsd).toBeGreaterThan(0);
  });
});
