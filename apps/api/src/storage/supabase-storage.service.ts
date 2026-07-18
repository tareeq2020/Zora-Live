import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/* Thin wrapper over Supabase Storage (service-role). Used for KYC .enc blobs
   (private bucket) and uploaded media (public bucket). Reuses SUPABASE_URL +
   SUPABASE_SERVICE_ROLE_KEY. */
@Injectable()
export class SupabaseStorage {
  private readonly client: SupabaseClient | null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  }

  private bucket(name: string) {
    if (!this.client) throw new Error('Supabase Storage not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    return this.client.storage.from(name);
  }

  async upload(bucket: string, path: string, buf: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const { error } = await this.bucket(bucket).upload(path, buf, { contentType, upsert: true });
    if (error) throw new Error('storage upload: ' + error.message);
  }

  /** Returns the object bytes, or null if the object does not exist. */
  async download(bucket: string, path: string): Promise<Buffer | null> {
    const { data, error } = await this.bucket(bucket).download(path);
    if (error) {
      if (/not.?found|does not exist|Object not found/i.test(error.message)) return null;
      throw new Error('storage download: ' + error.message);
    }
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  }

  publicUrl(bucket: string, path: string): string {
    return this.bucket(bucket).getPublicUrl(path).data.publicUrl;
  }
}
