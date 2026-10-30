import { revalidateTag } from 'next/cache';

/** Tag on every cached copy that must change as soon as anything is saved. */
export const DATA_TAG = 'kitchen';

/**
 * Marks every DATA_TAG copy stale; the database client calls this after each
 * successful write (src/db/write-hook.ts). Next records it only inside a
 * request — a route handler, a server action, or an after() callback (they
 * run with the request's work store) — so in a script or mid-render it
 * throws. That is logged, and the copies' two-hour safety re-read covers it.
 */
export function markDataChanged(): void {
  try {
    revalidateTag(DATA_TAG, { expire: 0 });
  } catch (err) {
    console.warn('[kitchen] could not mark the saved copy stale:', err instanceof Error ? err.message : err);
  }
}
