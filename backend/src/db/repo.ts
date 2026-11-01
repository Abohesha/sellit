import type { AiListing, Condition, PhotoKind } from '../ai/schema';
import type { CategoryMapping } from '../ebay/taxonomy';

export type ItemStatus = 'draft' | 'ready' | 'published' | 'sold';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Item {
  id: string;
  userId: string;
  status: ItemStatus;
  createdAt: Date;
}

export interface Photo {
  id: string;
  itemId: string;
  kind: PhotoKind;
  storagePath: string;
}

/** What the user confirmed in the review editor. Required before publishing. */
export interface UserEdits {
  title: string;
  description: string;
  condition: Condition;
  categoryId: string;
  brand: string | null;
  size: string | null;
  colour: string | null;
  /** Extra item specifics keyed by the marketplace's aspect names. */
  aspects: Record<string, string>;
  price: number;
}

export interface DraftRecord {
  itemId: string;
  marketplaceId: string;
  rawAiOutput: string;
  aiListing: AiListing;
  mapping: CategoryMapping | null;
  edits: UserEdits | null;
  reviewedAt: Date | null;
  aiCostUsd: number;
}

export interface NewDraft {
  itemId: string;
  marketplaceId: string;
  rawAiOutput: string;
  aiListing: AiListing;
  mapping: CategoryMapping | null;
  model: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface EbayConnection {
  id: string;
  userId: string;
  marketplaceId: string;
  refreshTokenEnc: string;
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
}

export interface PublishedListing {
  itemId: string;
  marketplaceId: string;
  sku: string;
  offerId: string;
  ebayListingId: string;
  url: string;
  status: 'active' | 'sold' | 'ended';
}

export interface JobRecord {
  id: string;
  type: string;
  status: JobStatus;
  error: string | null;
}

/** Everything the backend needs from storage. The pg implementation is the only Postgres-aware code. */
export interface Repo {
  ensureUser(userId: string): Promise<void>;
  hasAiConsent(userId: string): Promise<boolean>;
  recordConsent(userId: string, privacyPolicyVersion: string, aiProcessing: boolean): Promise<void>;

  createItem(userId: string): Promise<Item>;
  getItem(userId: string, itemId: string): Promise<Item | null>;
  /** Used by workers, which act on behalf of a user already authorised at enqueue time. */
  getItemById(itemId: string): Promise<Item | null>;
  setItemStatus(itemId: string, status: ItemStatus): Promise<void>;

  addPhoto(itemId: string, kind: PhotoKind, storagePath: string): Promise<Photo>;
  listPhotos(itemId: string): Promise<Photo[]>;

  saveDraft(draft: NewDraft): Promise<void>;
  getDraft(itemId: string): Promise<DraftRecord | null>;
  saveEdits(itemId: string, edits: UserEdits): Promise<void>;

  upsertEbayConnection(userId: string, marketplaceId: string, refreshTokenEnc: string, expiresAt: Date | null): Promise<void>;
  getEbayConnection(userId: string, marketplaceId: string): Promise<EbayConnection | null>;
  saveSellerSetup(
    connectionId: string,
    setup: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string; merchantLocationKey: string },
  ): Promise<void>;
  deleteEbayConnection(userId: string, marketplaceId: string): Promise<void>;

  upsertPublishedListing(listing: PublishedListing): Promise<void>;
  getPublishedListing(itemId: string, marketplaceId: string): Promise<PublishedListing | null>;

  upsertJob(job: { id: string; userId: string; itemId: string | null; type: string; status: JobStatus; error?: string | null }): Promise<void>;
  getLatestJob(itemId: string, type: string): Promise<JobRecord | null>;

  /** GDPR: everything we hold about the user, without secrets. */
  exportUserData(userId: string): Promise<unknown>;
  /** GDPR: removes all rows (cascade). Caller deletes stored photos and revokes eBay access. */
  deleteUser(userId: string): Promise<void>;
}
