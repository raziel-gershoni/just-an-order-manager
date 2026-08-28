import { readFileSync } from 'fs';

/**
 * Whether this process is allowed to send messages to real people.
 *
 * A scratch database branch isolates the data; it does not isolate Telegram or
 * WhatsApp. Delivering a recurring order on a branch still fired
 * `notifyNewOrder` to the owner and the baker, announcing the renewal of an
 * order that exists only on the branch — with a confirm button pointing at an
 * order id production has never heard of.
 *
 * So the guard is derived, not declared: if the database this process is
 * talking to is not the one `.env.local` configures, we are on a branch and
 * nothing goes out. Nobody has to remember a flag, which is the point — the
 * flag is exactly what would have been forgotten.
 *
 * In production there is no `.env.local` (Vercel injects the environment), so
 * the check finds nothing to compare and sending proceeds. That direction is
 * deliberately fail-open: a guard that silently muted the bakery's real
 * notifications would be worse than the problem it solves.
 */

let cached: { allowed: boolean; reason: string } | null = null;

function compute(): { allowed: boolean; reason: string } {
  if (process.env.DISABLE_OUTBOUND === '1') {
    return { allowed: false, reason: 'DISABLE_OUTBOUND=1' };
  }

  let configured: string | null = null;
  try {
    const match = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m);
    configured = match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    // No .env.local — production. Nothing to compare against.
    return { allowed: true, reason: 'no .env.local (production)' };
  }

  const running = process.env.DATABASE_URL ?? '';
  if (configured && running && configured !== running) {
    return { allowed: false, reason: 'DATABASE_URL is not the one in .env.local — this is a branch' };
  }
  return { allowed: true, reason: 'running against the configured database' };
}

/** Cached: the answer cannot change within a process. */
export function outboundAllowed(): boolean {
  cached ??= compute();
  return cached.allowed;
}

/**
 * Log once per suppressed send, so a muted message is visible in the terminal
 * rather than looking like the notification code silently did nothing.
 */
export function logSuppressed(what: string): void {
  cached ??= compute();
  console.warn(`[outbound] suppressed ${what} — ${cached.reason}`);
}
