import { Pool } from 'pg';
import { UnconfiguredProvider, type VisionProvider } from './ai/provider';
import type { Env } from './config/env';
import { PgRepo } from './db/pgRepo';
import type { Repo } from './db/repo';
import { createEbayHttp, type EbayHttp } from './ebay/client';
import { TokenCipher } from './ebay/crypto';
import type { EbayOAuthConfig } from './ebay/oauth';
import { SupabaseServices, type AuthVerifier, type PhotoStorage } from './storage/photoStorage';

/** Everything the API and the workers share. Both are stateless: all state lives in Postgres, Redis and storage. */
export interface Deps {
  env: Env;
  repo: Repo;
  storage: PhotoStorage;
  auth: AuthVerifier;
  ai: VisionProvider;
  ebayHttp: EbayHttp;
  oauth: EbayOAuthConfig;
  cipher: TokenCipher;
}

export function createAiProvider(env: Env): VisionProvider {
  switch (env.AI_PROVIDER) {
    case 'none':
      return new UnconfiguredProvider();
    default:
      // Add a case here once the provider is chosen (open decision in CLAUDE.md).
      throw new Error(`Unknown AI_PROVIDER "${env.AI_PROVIDER}"`);
  }
}

export function buildDeps(env: Env): Deps {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  const supabase = new SupabaseServices(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_PHOTO_BUCKET);
  return {
    env,
    repo: new PgRepo(pool),
    storage: supabase,
    auth: supabase,
    ai: createAiProvider(env),
    ebayHttp: createEbayHttp(env.EBAY_ENV),
    oauth: { env: env.EBAY_ENV, clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET, ruName: env.EBAY_RU_NAME },
    cipher: new TokenCipher(env.TOKEN_ENCRYPTION_KEY),
  };
}
