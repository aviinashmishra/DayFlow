import 'server-only';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let client: NeonQueryFunction<false, false> | null = null;

/** Neon HTTP client. Created lazily so builds do not need DATABASE_URL. */
export function db(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = neon(url);
  }
  return client;
}

export type Row = Record<string, unknown>;

export function ms(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
}
