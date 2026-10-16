import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';

/**
 * Private object storage for résumés. Objects are only ever read by the API
 * (service role) and streamed to their authenticated owner — never exposed via
 * public or predictable URLs.
 */
export interface FileStorage {
  readonly driver: 'supabase' | 'local' | 'memory';
  put(objectPath: string, data: Buffer, contentType: string): Promise<void>;
  /** Returns null when the object does not exist. */
  get(objectPath: string): Promise<Buffer | null>;
  remove(objectPaths: string[]): Promise<void>;
}

export class SupabaseFileStorage implements FileStorage {
  readonly driver = 'supabase' as const;
  private readonly client: SupabaseClient;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async put(objectPath: string, data: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(objectPath, data, { contentType, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  async get(objectPath: string): Promise<Buffer | null> {
    const { data, error } = await this.client.storage.from(this.bucket).download(objectPath);
    if (error) {
      const status = (error as { status?: number; statusCode?: string | number }).status ?? Number((error as { statusCode?: string }).statusCode);
      if (status === 404 || status === 400 || /not.?found/i.test(error.message)) return null;
      throw new Error(`Storage download failed: ${error.message}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(objectPaths: string[]): Promise<void> {
    if (!objectPaths.length) return;
    const { error } = await this.client.storage.from(this.bucket).remove(objectPaths);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }
}

/** Development driver: files under STORAGE_LOCAL_DIR. Refused in production by config. */
export class LocalFileStorage implements FileStorage {
  readonly driver = 'local' as const;
  constructor(private readonly root: string) {}

  private resolve(objectPath: string): string {
    const full = path.resolve(this.root, objectPath);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid object path');
    return full;
  }

  async put(objectPath: string, data: Buffer): Promise<void> {
    const full = this.resolve(objectPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: 'wx' });
  }

  async get(objectPath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(objectPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async remove(objectPaths: string[]): Promise<void> {
    await Promise.all(objectPaths.map((p) => fs.rm(this.resolve(p), { force: true })));
  }
}

/** In-memory driver for tests. */
export class MemoryFileStorage implements FileStorage {
  readonly driver = 'memory' as const;
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();
  async put(objectPath: string, data: Buffer, contentType: string): Promise<void> {
    if (this.objects.has(objectPath)) throw new Error('exists');
    this.objects.set(objectPath, { data: Buffer.from(data), contentType });
  }
  async get(objectPath: string): Promise<Buffer | null> {
    return this.objects.get(objectPath)?.data ?? null;
  }
  async remove(objectPaths: string[]): Promise<void> {
    for (const p of objectPaths) this.objects.delete(p);
  }
}

export function createFileStorage(cfg: AppConfig): FileStorage {
  if (cfg.storage.driver === 'supabase') {
    return new SupabaseFileStorage(cfg.supabase.url!, cfg.supabase.serviceRoleKey!, cfg.storage.bucket);
  }
  return new LocalFileStorage(path.resolve(cfg.storage.localDir));
}
