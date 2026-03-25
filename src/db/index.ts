import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import * as relations from './relations';

let _db: NeonHttpDatabase<typeof schema & typeof relations> | null = null;

export function getDb() {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!);
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
    return (getDb() as any)[prop];
  },
});
