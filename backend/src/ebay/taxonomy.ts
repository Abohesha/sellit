import type { Marketplace } from '../config/marketplaces';
import type { EbayHttp } from './client';

export interface CategoryCandidate {
  categoryId: string;
  categoryName: string;
}

export interface CategoryMapping {
  candidates: CategoryCandidate[];
  /** Top candidate; the user can change it in the review editor. */
  categoryId: string;
  categoryName: string;
  requiredAspects: string[];
}

interface SuggestionsResponse {
  categorySuggestions?: { category: { categoryId: string; categoryName: string } }[];
}

interface AspectsResponse {
  aspects?: { localizedAspectName: string; aspectConstraint?: { aspectRequired?: boolean } }[];
}

/** Uses an application token. Returns null when eBay has no suggestion for the query. */
export async function mapCategory(
  api: EbayHttp,
  appToken: string,
  marketplace: Marketplace,
  query: string,
): Promise<CategoryMapping | null> {
  const tree = marketplace.categoryTreeId;
  const headers = { contentLanguage: marketplace.contentLanguage, marketplaceId: marketplace.id };
  const suggestions = await api.request<SuggestionsResponse>({
    method: 'GET',
    path: `/commerce/taxonomy/v1/category_tree/${tree}/get_category_suggestions`,
    query: { q: query },
    accessToken: appToken,
    ...headers,
  });
  const candidates = (suggestions.data?.categorySuggestions ?? []).slice(0, 5).map((s) => ({
    categoryId: s.category.categoryId,
    categoryName: s.category.categoryName,
  }));
  const top = candidates[0];
  if (!top) return null;

  const aspects = await api.request<AspectsResponse>({
    method: 'GET',
    path: `/commerce/taxonomy/v1/category_tree/${tree}/get_item_aspects_for_category`,
    query: { category_id: top.categoryId },
    accessToken: appToken,
    ...headers,
  });
  const requiredAspects = (aspects.data?.aspects ?? [])
    .filter((a) => a.aspectConstraint?.aspectRequired)
    .map((a) => a.localizedAspectName);

  return { candidates, ...top, requiredAspects };
}
