import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** AES-256-GCM for refresh tokens at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}

/** Signed, expiring OAuth `state` so the callback can be tied to a user without a session. */
export interface OAuthState {
  userId: string;
  marketplaceId: string;
}

export function signState(secret: string, state: OAuthState, ttlMs = 10 * 60_000, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: state.userId, m: state.marketplaceId, e: now + ttlMs })).toString('base64url');
  return `${body}.${mac(secret, body)}`;
}

export function verifyState(secret: string, token: string, now = Date.now()): OAuthState | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(secret, body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u: string; m: string; e: number };
    if (typeof parsed.u !== 'string' || typeof parsed.m !== 'string' || parsed.e < now) return null;
    return { userId: parsed.u, marketplaceId: parsed.m };
  } catch {
    return null;
  }
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}
