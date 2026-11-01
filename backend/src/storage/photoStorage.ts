import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SignedUpload {
  path: string;
  /** PUT the file bytes straight to this URL (or use token with the Supabase client). Photos never pass through the backend. */
  signedUrl: string;
  token: string;
}

export interface PhotoStorage {
  createSignedUpload(path: string): Promise<SignedUpload>;
  createSignedReadUrls(paths: string[], ttlSeconds: number): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
}

export interface AuthVerifier {
  /** Returns the user id for a valid access token, else null. */
  verify(accessToken: string): Promise<string | null>;
}

/** Supabase-backed storage and auth. Only this file knows about Supabase. */
export class SupabaseServices implements PhotoStorage, AuthVerifier {
  private readonly client: SupabaseClient;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async verify(accessToken: string) {
    const { data, error } = await this.client.auth.getUser(accessToken);
    return error || !data.user ? null : data.user.id;
  }

  async createSignedUpload(path: string): Promise<SignedUpload> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Could not create signed upload URL: ${error?.message}`);
    return { path: data.path, signedUrl: data.signedUrl, token: data.token };
  }

  async createSignedReadUrls(paths: string[], ttlSeconds: number) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrls(paths, ttlSeconds);
    if (error || !data) throw new Error(`Could not sign photo URLs: ${error?.message}`);
    return data.map((d) => {
      if (!d.signedUrl) throw new Error(`Missing photo: ${d.path}`);
      return d.signedUrl;
    });
  }

  async deletePrefix(prefix: string) {
    const bucket = this.client.storage.from(this.bucket);
    // Layout is <userId>/<itemId>/<file>, so walk two levels.
    const { data: itemDirs } = await bucket.list(prefix, { limit: 1000 });
    for (const dir of itemDirs ?? []) {
      const { data: files } = await bucket.list(`${prefix}/${dir.name}`, { limit: 1000 });
      const paths = (files ?? []).map((f) => `${prefix}/${dir.name}/${f.name}`);
      if (paths.length) {
        const { error } = await bucket.remove(paths);
        if (error) throw new Error(`Could not delete photos: ${error.message}`);
      }
    }
  }
}
