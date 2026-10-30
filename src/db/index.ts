import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import * as relations from './relations';
import { instrumentClient } from './write-hook';
import { markDataChanged } from '@/lib/cache-tags';

let _db: NeonHttpDatabase<typeof schema & typeof relations> | null = null;

export function getDb() {
  if (!_db) {
    // Every save passes through this client; the wrapper marks the kitchen
    // screen's saved copy stale after each successful write.
    const sql = instrumentClient(neon(process.env.DATABASE_URL!), markDataChanged);
    _db = drizzle({
      client: sql,
      schema: { ...schema, ...relations },
    });
  }
  return _db;
}

// Convenience export — lazy initialized on first access
export const db = new Proxy({} as NeonHttpDatabase<typeof schema & typeof relations>, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});
