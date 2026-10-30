import { revalidateTag } from 'next/cache';

/** Tag on every cached copy that must change as soon as anything is saved. */
export const DATA_TAG = 'kitchen';

/**
 * Marks every DATA_TAG copy stale; the database client calls this after each
 * successful write (src/db/write-hook.ts). Next records it only inside a
 * request — a route handler, a server action, or an after() callback (they
 * run with the request's work store) — so in a script or mid-render it
 * throws. That is logged, and the copies' two-hour safety re-read covers it.
 *
 * Limit: Next queues each tag once per request. A second revalidateTag of the
 * same tag is dropped (revalidate.js), and after() callbacks only flush tags
 * that were not already queued when they began (withExecuteRevalidates in
 * revalidation-utils.js). So a write inside after() in a request that already
 * wrote before responding does not mark the copy stale again; one in a request
 * that had not written yet does. Today the only writes in after() are
 * order_drafts (the bot's dictated orders), which the screen doesn't show, and
 * the two-hour re-read bounds anything that slips through.
 */
export function markDataChanged(): void {
  try {
    revalidateTag(DATA_TAG, { expire: 0 });
  } catch (err) {
    console.warn('[kitchen] could not mark the saved copy stale:', err instanceof Error ? err.message : err);
  }
}
