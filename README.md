# Sellit

Photograph an item (3 to 5 guided shots), let AI draft the listing, review it, publish to eBay. eBay first, Europe first. See [CLAUDE.md](CLAUDE.md) for the product rules and architecture decisions.

## Layout

| Path | What |
| --- | --- |
| `backend/` | Fastify + TypeScript API, BullMQ workers, Postgres schema |
| `mobile/` | Expo (React Native) app: sign-in, consent, guided camera, review editor, publish |
| `backend/db/schema.sql` | Tables for the MVP data model (plain Postgres, EU Supabase project) |
| `backend/src/config/marketplaces.json` | Per-marketplace settings (currency, language, category tree, localised aspect names) |

The API and the workers are separate processes built from the same code (`npm start` and `npm run start:worker`). Both are stateless.

## Flow

1. App creates an item and uploads each photo straight to storage with a signed URL.
2. `POST /items/:id/draft` queues an `ai-draft` job. The worker signs read URLs, calls the AI provider, validates the JSON (retrying on invalid output), maps the category and required item specifics through eBay's Taxonomy API, and stores the draft with token usage and cost.
3. The user edits the draft in the app (`PUT /items/:id/review`). Publishing is refused until this has happened.
4. `POST /items/:id/publish` queues an `ebay-publish` job: refresh token, find seller policies and location, create inventory item, create offer, publish.

Idempotency: the eBay SKU is derived from the item id and the job id from item + marketplace. A retry reuses the existing inventory item and offer, and returns the existing listing if it is already published.

## Run it

Requirements: Node 22+, Redis, a Supabase project (EU region) with a private storage bucket `item-photos`, eBay sandbox keys.

```bash
cd backend
cp .env.example .env        # fill in the values
npm install
psql "$DATABASE_URL" -f db/schema.sql
npm test
npm run dev                 # API
npm run dev:worker          # workers (second terminal)
```

```bash
cd mobile
cp .env.example .env
npm install
npx expo start
```

## Status against the build phases

- Phase 1 (foundations): backend and app skeletons done. Still needed from you: eBay sandbox keys and one sandbox test listing.
- Phase 2 (AI draft): camera, review editor, strict JSON validation with retry and cost tracking are in. **No AI provider is wired up** (open decision): implement `VisionProvider` in `backend/src/ai/provider.ts`, add a case in `createAiProvider` in `backend/src/deps.ts`.
- Phase 3 (publish): OAuth, token encryption, policy lookup, inventory item, offer, publish are in and unit-tested against a fake eBay. **Not yet run against the real eBay sandbox**, which is the phase gate.

## Known gaps

- Nothing here has run against real Supabase, Redis or eBay. Tests cover AI validation, publish idempotency, token crypto, OAuth state, the API guards and the notification challenge. There is no database integration test yet.
- Seller setup only reads existing policies and locations; if the account has none, the publish job fails with a clear message. Creating sensible defaults is the next step.
- eBay category IDs for the marketplaces in `marketplaces.json`, the localised aspect names, and the condition mapping are from memory. Check them against the eBay docs and sandbox before relying on them. Some categories only accept certain conditions.
- `POST /ebay/notifications` acknowledges and does nothing. Verify the `X-EBAY-SIGNATURE` header and queue sold-item events before using it. Whether account-deletion handling is mandatory is unverified (see CLAUDE.md).
- `ENABLED_MARKETPLACES=EBAY_GB` in `.env.example` is a placeholder, not a decision.
- The privacy policy link and text in the consent screen are placeholders. Consent is recorded server-side with a policy version.
- Account deletion removes photos and all rows including the stored eBay refresh token. It does not call eBay to revoke the token.
- Auth verification calls Supabase on every request. Switch to local JWT verification before scale.
- Not built, by design: billing, other marketplaces, web version, sold-item sync.
