/**
 * Whether this process may send messages to real people.
 *
 * Local development points at the production database, so anything that runs
 * here can message real people. Set this when poking at the app locally and
 * every Telegram and WhatsApp send is suppressed and logged instead.
 *
 * An earlier version derived the answer by reading `.env.local`. That was
 * worse than the problem: a literal `readFileSync('.env.local')` is statically
 * traced by Vercel's bundler, which added the secrets file to the copy
 * manifest of eleven deployed routes. An explicit flag has nothing for a
 * bundler to follow and only one way to be read.
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
