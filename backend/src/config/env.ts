import { z } from 'zod';
import { ALL_MARKETPLACES } from './marketplaces';

const list = (s: string) =>
  s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  APP_DEEP_LINK: z.string().default('sellit://ebay-connected'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_PHOTO_BUCKET: z.string().default('item-photos'),

  /** base64 of 32 random bytes: `openssl rand -base64 32` */
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  STATE_SIGNING_SECRET: z.string().min(16),

  EBAY_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  EBAY_CLIENT_ID: z.string().min(1),
  EBAY_CLIENT_SECRET: z.string().min(1),
  /** eBay "RuName" (redirect URL name) registered for the OAuth flow. */
  EBAY_RU_NAME: z.string().min(1),
  EBAY_NOTIFICATION_ENDPOINT: z.string().url().optional(),
  EBAY_VERIFICATION_TOKEN: z.string().min(32).max(80).optional(),

  ENABLED_MARKETPLACES: z
    .string()
    .transform(list)
    .refine((ids) => ids.length > 0 && ids.every((id) => ALL_MARKETPLACES.some((m) => m.id === id)), {
      message: 'ENABLED_MARKETPLACES must be a comma list of ids from src/config/marketplaces.json',
    }),

  /** Open decision: provider is not chosen yet. "none" makes AI calls fail loudly. */
  AI_PROVIDER: z.string().default('none'),
  AI_MODEL: z.string().default(''),
  AI_PRICE_INPUT_USD_PER_MTOK: z.coerce.number().min(0).default(0),
  AI_PRICE_OUTPUT_USD_PER_MTOK: z.coerce.number().min(0).default(0),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
