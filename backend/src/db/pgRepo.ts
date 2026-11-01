import { Pool, type QueryResultRow } from 'pg';
import type { AiListing, PhotoKind } from '../ai/schema';
import type { CategoryMapping } from '../ebay/taxonomy';
import type {
  DraftRecord,
  EbayConnection,
  Item,
  ItemStatus,
  JobRecord,
  NewDraft,
  Photo,
  PublishedListing,
  Repo,
  UserEdits,
} from './repo';

type Row = QueryResultRow;

export class PgRepo implements Repo {
  constructor(private readonly pool: Pool) {}

  private async rows(text: string, values: unknown[] = []): Promise<Row[]> {
    return (await this.pool.query(text, values)).rows;
  }

  async ensureUser(userId: string) {
    await this.pool.query('insert into app_users (id) values ($1) on conflict do nothing', [userId]);
  }

  async hasAiConsent(userId: string) {
    const [r] = await this.rows('select ai_processing_consent_at from app_users where id = $1', [userId]);
    return Boolean(r?.ai_processing_consent_at);
  }

  async recordConsent(userId: string, version: string, aiProcessing: boolean) {
    await this.pool.query(
      `update app_users set privacy_policy_version = $2, privacy_consent_at = now(),
         ai_processing_consent_at = case when $3 then now() else null end where id = $1`,
      [userId, version, aiProcessing],
    );
  }

  async createItem(userId: string): Promise<Item> {
    const [row] = await this.rows('insert into items (user_id) values ($1) returning *', [userId]);
    return toItem(row!);
  }

  async getItem(userId: string, itemId: string) {
    const [row] = await this.rows('select * from items where id = $1 and user_id = $2', [itemId, userId]);
    return row ? toItem(row) : null;
  }

  async getItemById(itemId: string) {
    const [row] = await this.rows('select * from items where id = $1', [itemId]);
    return row ? toItem(row) : null;
  }

  async setItemStatus(itemId: string, status: ItemStatus) {
    await this.pool.query('update items set status = $2, updated_at = now() where id = $1', [itemId, status]);
  }

  async addPhoto(itemId: string, kind: PhotoKind, storagePath: string): Promise<Photo> {
    const [row] = await this.rows('insert into photos (item_id, kind, storage_path) values ($1, $2, $3) returning *', [
      itemId,
      kind,
      storagePath,
    ]);
    return toPhoto(row!);
  }

  async listPhotos(itemId: string) {
    return (await this.rows('select * from photos where item_id = $1 order by created_at', [itemId])).map(toPhoto);
  }

  async saveDraft(d: NewDraft) {
    await this.pool.query(
      `insert into listing_drafts (item_id, marketplace_id, raw_ai_output, ai_listing, mapping, ai_model, ai_attempts,
         ai_input_tokens, ai_output_tokens, ai_cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (item_id) do update set marketplace_id = excluded.marketplace_id, raw_ai_output = excluded.raw_ai_output,
         ai_listing = excluded.ai_listing, mapping = excluded.mapping, edits = null, reviewed_at = null,
         ai_model = excluded.ai_model, ai_attempts = excluded.ai_attempts, ai_input_tokens = excluded.ai_input_tokens,
         ai_output_tokens = excluded.ai_output_tokens, ai_cost_usd = listing_drafts.ai_cost_usd + excluded.ai_cost_usd`,
      [
        d.itemId,
        d.marketplaceId,
        d.rawAiOutput,
        JSON.stringify(d.aiListing),
        d.mapping ? JSON.stringify(d.mapping) : null,
        d.model,
        d.attempts,
        d.inputTokens,
        d.outputTokens,
        d.costUsd,
      ],
    );
  }

  async getDraft(itemId: string): Promise<DraftRecord | null> {
    const [r] = await this.rows('select * from listing_drafts where item_id = $1', [itemId]);
    if (!r) return null;
    return {
      itemId: r.item_id,
      marketplaceId: r.marketplace_id,
      rawAiOutput: r.raw_ai_output,
      aiListing: r.ai_listing as AiListing,
      mapping: (r.mapping as CategoryMapping | null) ?? null,
      edits: (r.edits as UserEdits | null) ?? null,
      reviewedAt: r.reviewed_at,
      aiCostUsd: Number(r.ai_cost_usd),
    };
  }

  async saveEdits(itemId: string, edits: UserEdits) {
    await this.pool.query('update listing_drafts set edits = $2, reviewed_at = now() where item_id = $1', [
      itemId,
      JSON.stringify(edits),
    ]);
  }

  async upsertEbayConnection(userId: string, marketplaceId: string, enc: string, expiresAt: Date | null) {
    await this.pool.query(
      `insert into ebay_connections (user_id, marketplace_id, refresh_token_enc, refresh_token_expires_at)
       values ($1, $2, $3, $4)
       on conflict (user_id, marketplace_id) do update set refresh_token_enc = excluded.refresh_token_enc,
         refresh_token_expires_at = excluded.refresh_token_expires_at`,
      [userId, marketplaceId, enc, expiresAt],
    );
  }

  async getEbayConnection(userId: string, marketplaceId: string): Promise<EbayConnection | null> {
    const [r] = await this.rows('select * from ebay_connections where user_id = $1 and marketplace_id = $2', [userId, marketplaceId]);
    return r
      ? {
          id: r.id,
          userId: r.user_id,
          marketplaceId: r.marketplace_id,
          refreshTokenEnc: r.refresh_token_enc,
          fulfillmentPolicyId: r.fulfillment_policy_id,
          paymentPolicyId: r.payment_policy_id,
          returnPolicyId: r.return_policy_id,
          merchantLocationKey: r.merchant_location_key,
        }
      : null;
  }

  async saveSellerSetup(
    id: string,
    s: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string; merchantLocationKey: string },
  ) {
    await this.pool.query(
      `update ebay_connections set fulfillment_policy_id = $2, payment_policy_id = $3, return_policy_id = $4,
         merchant_location_key = $5 where id = $1`,
      [id, s.fulfillmentPolicyId, s.paymentPolicyId, s.returnPolicyId, s.merchantLocationKey],
    );
  }

  async deleteEbayConnection(userId: string, marketplaceId: string) {
    await this.pool.query('delete from ebay_connections where user_id = $1 and marketplace_id = $2', [userId, marketplaceId]);
  }

  async upsertPublishedListing(l: PublishedListing) {
    await this.pool.query(
      `insert into published_listings (item_id, marketplace_id, sku, offer_id, ebay_listing_id, url, status)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (item_id, marketplace_id) do update set sku = excluded.sku, offer_id = excluded.offer_id,
         ebay_listing_id = excluded.ebay_listing_id, url = excluded.url, status = excluded.status`,
      [l.itemId, l.marketplaceId, l.sku, l.offerId, l.ebayListingId, l.url, l.status],
    );
  }

  async getPublishedListing(itemId: string, marketplaceId: string): Promise<PublishedListing | null> {
    const [r] = await this.rows('select * from published_listings where item_id = $1 and marketplace_id = $2', [itemId, marketplaceId]);
    return r
      ? {
          itemId: r.item_id,
          marketplaceId: r.marketplace_id,
          sku: r.sku,
          offerId: r.offer_id,
          ebayListingId: r.ebay_listing_id,
          url: r.url,
          status: r.status,
        }
      : null;
  }

  async upsertJob(j: { id: string; userId: string; itemId: string | null; type: string; status: string; error?: string | null }) {
    await this.pool.query(
      `insert into jobs (id, user_id, item_id, type, status, error) values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set status = excluded.status, error = excluded.error, updated_at = now()`,
      [j.id, j.userId, j.itemId, j.type, j.status, j.error ?? null],
    );
  }

  async getLatestJob(itemId: string, type: string): Promise<JobRecord | null> {
    const [r] = await this.rows('select id, type, status, error from jobs where item_id = $1 and type = $2 order by created_at desc limit 1', [
      itemId,
      type,
    ]);
    return r ? { id: r.id, type: r.type, status: r.status, error: r.error } : null;
  }

  async exportUserData(userId: string) {
    const q = async (text: string) => this.rows(text, [userId]);
    return {
      exportedAt: new Date().toISOString(),
      user: await q('select id, created_at, privacy_policy_version, privacy_consent_at, ai_processing_consent_at from app_users where id = $1'),
      items: await q('select * from items where user_id = $1'),
      photos: await q('select p.* from photos p join items i on i.id = p.item_id where i.user_id = $1'),
      listingDrafts: await q('select d.* from listing_drafts d join items i on i.id = d.item_id where i.user_id = $1'),
      publishedListings: await q('select l.* from published_listings l join items i on i.id = l.item_id where i.user_id = $1'),
      // Refresh tokens are deliberately excluded.
      ebayConnections: await q(
        'select marketplace_id, fulfillment_policy_id, payment_policy_id, return_policy_id, merchant_location_key, created_at from ebay_connections where user_id = $1',
      ),
    };
  }

  async deleteUser(userId: string) {
    await this.pool.query('delete from app_users where id = $1', [userId]);
  }
}

function toItem(r: Row): Item {
  return { id: r.id, userId: r.user_id, status: r.status, createdAt: r.created_at };
}

function toPhoto(r: Row): Photo {
  return { id: r.id, itemId: r.item_id, kind: r.kind, storagePath: r.storage_path };
}
