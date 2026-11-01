/**
 * Meta signs every webhook POST: X-Hub-Signature-256 is 'sha256=' plus the hex
 * HMAC-SHA256 of the raw body under the app secret. The secret is the Meta
 * app's (shared with whatever else that app serves), not this number's.
 * Without the check, anyone could post a WhatsApp-shaped body to the route.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** True when `header` is the body's signature under `secret`. Constant-time compare. */
export function isValidWhatsAppSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`);
  const given = Buffer.from(header);
  // timingSafeEqual throws on different lengths
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * verified: signed with WHATSAPP_APP_SECRET. rejected: the secret is set and the
 * signature is missing or wrong. unconfigured: no secret (unset or ''), so
 * nothing can be verified and nothing is processed unsigned.
 */
export function checkWhatsAppSignature(
  rawBody: string,
  header: string | null
): 'verified' | 'rejected' | 'unconfigured' {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return 'unconfigured';
  return isValidWhatsAppSignature(rawBody, header, secret) ? 'verified' : 'rejected';
}

/**
 * Meta's GET handshake check. An unset or empty WHATSAPP_VERIFY_TOKEN never
 * matches, so a missing env can't be satisfied by an empty hub.verify_token.
 */
export function isValidVerifyToken(given: string | null): boolean {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
