# Project: One-Photo Listing App (eBay first, Europe)

## What this is
A mobile camera app. The user photographs an item (3 to 5 guided shots), AI drafts a listing, the user reviews and edits it, and the app publishes it to eBay in a few taps. Other platforms (Vinted, Depop, Facebook Marketplace) come later and are not in the MVP.

Main users: single, everyday sellers. Secondary: small resellers.
Market: Europe. First eBay marketplace to launch on: TBD (see Open decisions).
Scale target: under 100 users at launch, designed to grow to hundreds of thousands without a rewrite.

## Decisions already made (do not change without asking)
- Mobile app: React Native with Expo, TypeScript. Start with expo-camera. Move to react-native-vision-camera only if the camera needs it.
- Backend: Node.js with TypeScript (NestJS or Fastify).
- Database, auth and photo storage: Supabase (PostgreSQL), EU region only.
- Job queue: BullMQ with Redis.
- AI: a vision-capable LLM API, called only from the backend.
- eBay is the only direct publishing integration in the MVP. Amazon is deprioritised.
- Monetisation is undecided. Do not build billing yet.

## Architecture rules
1. Only the backend talks to eBay and to the AI service. The mobile app talks only to the backend (and to Supabase for auth and signed photo uploads).
2. Keep the backend stateless so more copies can run behind a load balancer.
3. Upload photos directly to storage with signed upload URLs. Photo traffic must not pass through the backend.
4. Slow work (AI calls, eBay publishing, sold-item notifications) runs as background jobs in queues, handled by separate workers.
5. Jobs must be safe to retry. Use a unique key per publish so a retry never creates a duplicate eBay listing.
6. Keep marketplace and country settings in configuration, not hard-coded, so adding countries needs no new code.
7. Keep business logic in our own backend, not in Supabase-specific features, so we can move off Supabase later.

## Main flow
Capture photos -> upload to storage -> backend sends photos to AI -> AI returns strict JSON (title, description, category, brand, size, colour, condition, price range) -> backend validates it and maps it to eBay categories and required item specifics -> user reviews and edits in the app -> backend creates the eBay inventory item, creates the offer, publishes it.

## eBay integration notes
- Each user connects their own eBay account through OAuth. Never ask users for their eBay password.
- Scopes needed include sell.inventory, sell.account and sell.fulfillment.
- Store refresh tokens encrypted. Never log tokens and never send them to the app.
- Before a user can publish, they need fulfillment (shipping), payment and return policies and an inventory location. These are per marketplace, so a UK policy does not apply on a German marketplace. Create sensible defaults or guide the user.
- Listing creation is: create inventory item, create offer, publish offer.
- Test everything in the eBay sandbox before using production keys.
- Subscribe to eBay notifications for sold items and process them through a queue.
- eBay limits API calls per application, shared across all users. A figure of 5,000 calls per day was mentioned by eBay support staff but is unverified. Check the real limit with getRateLimits. The free Application Growth Check raises limits, so apply before public launch.
- UNVERIFIED: eBay's API License Agreement was recently updated with restrictions on AI content and restricted APIs. Read it before building the AI listing feature around it.
- UNVERIFIED: eBay may require production apps to handle account-deletion notifications. Confirm in the developer docs.

## Data model (MVP)
User, EbayConnection (per user and marketplace, encrypted refresh token, policy ids, location key), Item (status: draft, ready, published, sold), Photo, ListingDraft (includes raw AI output), PublishedListing (eBay listing id, SKU, status, URL), Job.

## Privacy and GDPR (applies from day one)
- Database and storage in an EU region only.
- Provide a privacy policy, explain AI processing, and record consent.
- Support export and deletion of a user's data, including disconnecting eBay and deleting photos.
- Check that the AI vendor does not train on our photos.
- Store only what is needed. Do not keep eBay buyer data beyond what a feature requires.

## AI listing rules
- The AI must return strict JSON that we validate. Reject and retry on invalid output.
- Show uncertainty. The user must review every draft before anything is published.
- Brand and size should come from a tag or label shot where possible.
- Track AI cost per listing from the start.

## Out of scope for the MVP
Direct publishing to Vinted, Depop, Marketplace or Amazon (a copy-and-open flow can come later), cross-platform sold-item sync, a web version, billing and commission.
Do not use browser extensions, scraping or shared accounts to post on other platforms. They break platform terms and put users' accounts at risk.

## Build phases
1. Foundations: eBay developer account, sandbox keys, one sandbox test listing, app and backend skeleton.
2. AI draft: guided camera, AI listing JSON, review editor.
3. Publish: OAuth, seller setup, sandbox publish.
   Gate: a sandbox listing publishes end to end.
4. Pilot: production keys, small group of users on one marketplace.
   Gate: users finish listings and come back.
5. Expand: more marketplaces, sold-item notifications, other platforms.

## Current status
Phase 1 in progress. The eBay developer account is being created by the owner. Next: sandbox keys, then one sandbox test listing. In parallel: camera prototype and the AI listing prompt.

## Open decisions
- First European eBay marketplace (UK, Germany, France, etc.).
- AI provider, model and target cost per listing.
- Monetisation model (subscription, per-listing fee, or commission).
- Whether a native app is required for the first test or a mobile web app is enough.

## Working conventions
- Ask before changing a decision listed above.
- Never commit secrets, API keys or tokens. Use environment variables and a secrets manager.
- Write tests for the eBay publishing flow and the AI JSON validation.
- Keep changes small and explain what you changed.
