import type { Marketplace } from '../config/marketplaces';
import type { VisionImage } from './provider';

export function buildSystemPrompt(marketplace: Marketplace): string {
  return `You draft second-hand marketplace listings from photos of one item.
Reply with ONE JSON object and nothing else: no prose, no markdown fences.

Rules:
- Write the title (max 80 chars) and description in the language of locale ${marketplace.contentLanguage}.
- Read brand and size from a tag or label photo when one is provided; set source "tag" then. Never guess a brand or size you cannot see: use value null, confidence 0, source "unknown".
- Every uncertain field is {"value": <string|null>, "confidence": <0..1>, "source": "tag"|"photo"|"inferred"|"unknown"}.
- condition.value is one of NEW, LIKE_NEW, VERY_GOOD, GOOD, ACCEPTABLE. Describe visible flaws honestly in the description.
- category.value is a short product-type phrase (e.g. "men's running shoes") used to search eBay's category tree.
- priceRange is a realistic used-item range in ${marketplace.currency}: {"min": number, "max": number, "currency": "${marketplace.currency}"}.
- itemSpecifics holds other facts you can see (material, model, style) as string pairs. No invented values.
- uncertaintyNotes lists anything the seller should double-check.

Schema keys, all required: title, description, category, brand, size, colour, condition, priceRange, itemSpecifics, uncertaintyNotes.`;
}

export function buildUserPrompt(images: VisionImage[]): string {
  const order = images.map((img, i) => `Photo ${i + 1}: ${img.kind}`).join('\n');
  return `Draft the listing for the item in these photos.\n${order}`;
}

export function buildRetryPrompt(base: string, previousError: string): string {
  return `${base}\n\nYour previous reply was rejected: ${previousError}\nReply again with only the corrected JSON object.`;
}
