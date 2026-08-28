/**
 * Whether this process may send messages to real people.
 *
 * A scratch database branch isolates rows; it does not isolate Telegram or
 * WhatsApp. Delivering a recurring order against a branch still messaged the
 * owner and the baker about an order that existed only on the branch, because
 * `createNextRecurringOrder` calls `notifyNewOrder` two levels down.
 *
 * The first version of this guard derived the answer by reading `.env.local`
 * and comparing its DATABASE_URL to the running one. That was worse than the
 * problem: a literal `readFileSync('.env.local')` is statically traced by
 * Vercel's bundler, which duly added the secrets file to the copy manifest of
 * eleven deployed routes — and on a `--prebuilt` deploy it would have shipped,
 * then compared a laptop's connection string against production's and muted
 * every real notification the bakery sends. It also failed open in every
 * ambiguous case: wrong working directory, an `export` prefix, an unset var.
 *
 * So it is an explicit flag now. No filesystem, nothing for a bundler to
 * follow, and only one way to read it.
 *
 *   DISABLE_OUTBOUND=1 npx next dev
 */
export function outboundAllowed(): boolean {
  return process.env.DISABLE_OUTBOUND !== '1';
}

/** Log every suppressed send, so a muted message is visible rather than silent. */
export function logSuppressed(what: string): void {
  console.warn(`[outbound] suppressed ${what} — DISABLE_OUTBOUND=1`);
}
