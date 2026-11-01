import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CONDITIONS, PHOTO_KINDS } from './ai/schema';
import { getEnabledMarketplaces, getMarketplace } from './config/marketplaces';
import type { Deps } from './deps';
import { signState, verifyState } from './ebay/crypto';
import { buildConsentUrl, exchangeAuthorizationCode } from './ebay/oauth';
import { draftJobId, publishJobId, type Queues } from './queue';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export const MAX_PHOTOS = 5;
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

const editsSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(4000),
  condition: z.enum(CONDITIONS),
  categoryId: z.string().trim().min(1).max(20),
  brand: z.string().trim().max(100).nullable(),
  size: z.string().trim().max(50).nullable(),
  colour: z.string().trim().max(50).nullable(),
  aspects: z.record(z.string().max(60), z.string().max(200)),
  price: z.number().positive().max(100_000),
});

export function buildApp(deps: Deps, queues: Queues): FastifyInstance {
  const { env, repo } = deps;
  const app = Fastify({ logger: { level: 'info', redact: ['req.headers.authorization'] } });

  const enabled = env.ENABLED_MARKETPLACES;
  const marketplaceOf = (id: string) => getMarketplace(id, enabled);

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request', issues: err.issues });
    if (err.message.includes('is not enabled')) return reply.code(400).send({ error: 'marketplace_not_enabled' });
    req.log.error({ err: err.message }, 'request failed');
    return reply.code(err.statusCode ?? 500).send({ error: err.statusCode && err.statusCode < 500 ? err.message : 'internal_error' });
  });

  app.get('/health', async () => ({ ok: true }));

  // --- eBay endpoints that are called by eBay or a browser redirect, so no bearer token ---

  app.get('/ebay/callback', async (req, reply) => {
    const q = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.query);
    const state = verifyState(env.STATE_SIGNING_SECRET, q.state);
    if (!state) return reply.code(400).send({ error: 'invalid_state' });
    marketplaceOf(state.marketplaceId);
    const tokens = await exchangeAuthorizationCode(deps.oauth, q.code);
    await repo.upsertEbayConnection(
      state.userId,
      state.marketplaceId,
      deps.cipher.encrypt(tokens.refreshToken),
      tokens.refreshTokenExpiresAt,
    );
    const target = new URL(env.APP_DEEP_LINK);
    target.searchParams.set('marketplaceId', state.marketplaceId);
    return reply.redirect(target.toString());
  });

  // Marketplace account-deletion notifications: eBay first verifies the endpoint with a challenge.
  // UNVERIFIED requirement (see CLAUDE.md): confirm in the developer docs before production.
  app.get('/ebay/notifications', async (req, reply) => {
    const { challenge_code } = z.object({ challenge_code: z.string().min(1) }).parse(req.query);
    if (!env.EBAY_VERIFICATION_TOKEN || !env.EBAY_NOTIFICATION_ENDPOINT) {
      return reply.code(503).send({ error: 'notifications_not_configured' });
    }
    const challengeResponse = createHash('sha256')
      .update(challenge_code)
      .update(env.EBAY_VERIFICATION_TOKEN)
      .update(env.EBAY_NOTIFICATION_ENDPOINT)
      .digest('hex');
    return reply.header('Content-Type', 'application/json').send({ challengeResponse });
  });

  // We keep no eBay buyer data, so there is nothing to delete yet. Acknowledge only.
  // TODO: verify the X-EBAY-SIGNATURE header before acting on any payload, and queue sold-item events here.
  app.post('/ebay/notifications', async (_req, reply) => reply.code(204).send());

  // --- authenticated API ---

  app.register(async (api) => {
    api.decorateRequest('userId', '');
    api.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const userId = token ? await deps.auth.verify(token) : null;
      if (!userId) return reply.code(401).send({ error: 'unauthorized' });
      req.userId = userId;
      await repo.ensureUser(userId);
    });

    api.get('/marketplaces', async () =>
      getEnabledMarketplaces(enabled).map((m) => ({ id: m.id, country: m.country, currency: m.currency })),
    );

    // GDPR
    api.post('/me/consent', async (req) => {
      const body = z.object({ privacyPolicyVersion: z.string().min(1).max(40), aiProcessing: z.boolean() }).parse(req.body);
      await repo.recordConsent(req.userId, body.privacyPolicyVersion, body.aiProcessing);
      return { ok: true };
    });

    api.get('/me/export', async (req) => repo.exportUserData(req.userId));

    api.delete('/me', async (req, reply) => {
      // Photos first, then rows (this also removes the stored eBay tokens, which disconnects eBay).
      await deps.storage.deletePrefix(req.userId);
      await repo.deleteUser(req.userId);
      return reply.code(204).send();
    });

    // Items and photos
    api.post('/items', async (req, reply) => reply.code(201).send(await repo.createItem(req.userId)));

    api.get('/items/:id', async (req, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { marketplaceId } = z.object({ marketplaceId: z.string().optional() }).parse(req.query);
      const item = await repo.getItem(req.userId, id);
      if (!item) return reply.code(404).send({ error: 'not_found' });
      const [photos, draft, draftJob, publishJob, published] = await Promise.all([
        repo.listPhotos(id),
        repo.getDraft(id),
        repo.getLatestJob(id, 'draft'),
        repo.getLatestJob(id, 'publish'),
        marketplaceId ? repo.getPublishedListing(id, marketplaceId) : null,
      ]);
      return {
        item,
        photos: photos.map((p) => ({ id: p.id, kind: p.kind })),
        draft: draft && { marketplaceId: draft.marketplaceId, ai: draft.aiListing, mapping: draft.mapping, edits: draft.edits },
        draftJob,
        publishJob,
        published,
      };
    });

    api.post('/items/:id/photos', async (req, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const body = z.object({ kind: z.enum(PHOTO_KINDS), contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).parse(req.body);
      const item = await repo.getItem(req.userId, id);
      if (!item) return reply.code(404).send({ error: 'not_found' });
      if ((await repo.listPhotos(id)).length >= MAX_PHOTOS) return reply.code(409).send({ error: 'too_many_photos' });

      const path = `${req.userId}/${id}/${randomUUID()}.${PHOTO_TYPES[body.contentType]}`;
      const upload = await deps.storage.createSignedUpload(path);
      const photo = await repo.addPhoto(id, body.kind, path);
      return reply.code(201).send({ photoId: photo.id, upload: { ...upload, bucket: env.SUPABASE_PHOTO_BUCKET } });
    });

    // AI draft (background job)
    api.post('/items/:id/draft', async (req, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const body = z.object({ marketplaceId: z.string(), requestId: z.uuid() }).parse(req.body);
      marketplaceOf(body.marketplaceId);
      const item = await repo.getItem(req.userId, id);
      if (!item) return reply.code(404).send({ error: 'not_found' });
      if (!(await repo.hasAiConsent(req.userId))) return reply.code(403).send({ error: 'ai_consent_required' });
      if ((await repo.listPhotos(id)).length === 0) return reply.code(409).send({ error: 'no_photos' });

      // The client-supplied requestId makes a retried HTTP call enqueue only one job.
      const jobId = draftJobId(body.requestId);
      await queues.draft.add('draft', { userId: req.userId, itemId: id, marketplaceId: body.marketplaceId }, { jobId });
      await repo.upsertJob({ id: jobId, userId: req.userId, itemId: id, type: 'draft', status: 'queued' });
      return reply.code(202).send({ jobId });
    });

    // The user's reviewed version. Nothing publishes without this step.
    api.put('/items/:id/review', async (req, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const edits = editsSchema.parse(req.body);
      const item = await repo.getItem(req.userId, id);
      if (!item) return reply.code(404).send({ error: 'not_found' });
      if (!(await repo.getDraft(id))) return reply.code(409).send({ error: 'no_draft' });
      await repo.saveEdits(id, edits);
      if (item.status === 'draft') await repo.setItemStatus(id, 'ready');
      return { ok: true };
    });

    api.post('/items/:id/publish', async (req, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { marketplaceId } = z.object({ marketplaceId: z.string() }).parse(req.body);
      marketplaceOf(marketplaceId);
      const item = await repo.getItem(req.userId, id);
      if (!item) return reply.code(404).send({ error: 'not_found' });
      const draft = await repo.getDraft(id);
      if (!draft?.reviewedAt) return reply.code(409).send({ error: 'review_required' });
      if (!(await repo.getEbayConnection(req.userId, marketplaceId))) return reply.code(409).send({ error: 'ebay_not_connected' });

      const jobId = publishJobId(id, marketplaceId);
      const existing = await queues.publish.getJob(jobId);
      if (existing && (await existing.isFailed())) await existing.remove(); // allow a manual retry after a final failure
      await queues.publish.add('publish', { userId: req.userId, itemId: id, marketplaceId }, { jobId });
      await repo.upsertJob({ id: jobId, userId: req.userId, itemId: id, type: 'publish', status: 'queued' });
      return reply.code(202).send({ jobId });
    });

    // eBay connection
    api.get('/ebay/connect', async (req) => {
      const { marketplaceId } = z.object({ marketplaceId: z.string() }).parse(req.query);
      marketplaceOf(marketplaceId);
      const state = signState(env.STATE_SIGNING_SECRET, { userId: req.userId, marketplaceId });
      return { url: buildConsentUrl(deps.oauth, state) };
    });

    api.get('/ebay/connections', async (req) => {
      const out: { marketplaceId: string; connected: boolean }[] = [];
      for (const m of getEnabledMarketplaces(enabled)) {
        out.push({ marketplaceId: m.id, connected: Boolean(await repo.getEbayConnection(req.userId, m.id)) });
      }
      return out;
    });

    api.delete('/ebay/connections/:marketplaceId', async (req, reply) => {
      const { marketplaceId } = z.object({ marketplaceId: z.string() }).parse(req.params);
      await repo.deleteEbayConnection(req.userId, marketplaceId);
      return reply.code(204).send();
    });
  });

  return app;
}
