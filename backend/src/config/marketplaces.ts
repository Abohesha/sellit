import raw from './marketplaces.json';

export interface Marketplace {
  id: string;
  country: string;
  currency: string;
  contentLanguage: string;
  categoryTreeId: string;
  siteDomain: string;
  /** Aspect (item specific) names are localised per marketplace. */
  aspectNames: { brand: string; size: string; colour: string };
}

export const ALL_MARKETPLACES: readonly Marketplace[] = raw;

export function getMarketplace(id: string, enabledIds: readonly string[]): Marketplace {
  const found = ALL_MARKETPLACES.find((m) => m.id === id);
  if (!found || !enabledIds.includes(id)) {
    throw new Error(`Marketplace ${id} is not enabled`);
  }
  return found;
}

export function getEnabledMarketplaces(enabledIds: readonly string[]): Marketplace[] {
  return ALL_MARKETPLACES.filter((m) => enabledIds.includes(m.id));
}
