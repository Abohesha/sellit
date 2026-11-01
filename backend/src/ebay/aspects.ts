import type { Marketplace } from '../config/marketplaces';

export interface AspectSource {
  brand?: string | null;
  size?: string | null;
  colour?: string | null;
  /** Other item specifics, already keyed by the marketplace's aspect names. */
  extra?: Record<string, string>;
}

/** Build eBay `product.aspects` using the marketplace's localised aspect names. */
export function buildAspects(marketplace: Marketplace, src: AspectSource): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(src.extra ?? {})) if (value.trim()) out[name] = [value.trim()];
  const names = marketplace.aspectNames;
  if (src.brand?.trim()) out[names.brand] = [src.brand.trim()];
  if (src.size?.trim()) out[names.size] = [src.size.trim()];
  if (src.colour?.trim()) out[names.colour] = [src.colour.trim()];
  return out;
}

/** Required aspect names (from the Taxonomy API) that the listing does not yet provide. */
export function missingRequiredAspects(required: readonly string[], aspects: Record<string, string[]>): string[] {
  const have = new Set(Object.keys(aspects).map((k) => k.toLowerCase()));
  return required.filter((name) => !have.has(name.toLowerCase()));
}
