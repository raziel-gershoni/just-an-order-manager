/**
 * Normalize an Israeli phone number to E.164 format (without +).
 * Handles: 050-1234567, 0501234567, +972501234567, 972501234567
 */
export function normalizePhoneNumber(phone: string): string | null {
  // Strip every non-digit: spaces, dashes, parens, +, and — crucially —
  // invisible bidi-control marks (U+202A–202E, U+200E/200F). Those get baked
  // into a number when it's typed or pasted into an RTL/Hebrew field; the old
  // character-class strip left them in place, so a valid number like
  // "‭051-2774420‬" normalized to null and the send failed silently.
  let digits = phone.replace(/\D/g, '');

  // Tolerate an international 00 prefix: 00972… → 972…
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Already in international format
  if (digits.startsWith('972') && digits.length === 12) {
    return digits;
  }

  // Israeli local format: 0XX-XXXXXXX
  if (digits.startsWith('0') && digits.length === 10) {
    return '972' + digits.slice(1);
  }

  return null;
}

/**
 * A click-to-chat link for a stored number, or null when it isn't a number we
 * can open a chat with.
 *
 * Deliberately reuses normalizePhoneNumber rather than the looser local copy
 * that grew on the customer detail screen: that one strips non-digits and
 * hands back whatever is left, so a junk value produced `https://wa.me/` — a
 * live link to nothing. customer_phones.phone is a bare varchar(50) with no
 * format constraint and the write path only strips invisible characters, so
 * the null branch is real rather than defensive.
 *
 * normalizePhoneNumber lives HERE rather than in whatsapp.ts, and whatsapp.ts
 * re-exports it: this module is imported by the customers list, and the other
 * direction would pull the Meta send code and a process.env read into the
 * browser bundle for the sake of one pure function.
 *
 * No ?text= prefill: staff messages are all different, and clearing someone
 * else's draft is slower than typing into an empty box.
 */
export function waHref(phone: string): string | null {
  const intl = normalizePhoneNumber(phone);
  return intl ? `https://wa.me/${intl}` : null;
}

/**
 * Leave the app for an external https URL.
 *
 * Inside Telegram the WebView needs WebApp.openLink — a bare navigation works
 * but hands the user a one-way trip out of the mini app, and openLink is never
 * reached in a plain browser.
 *
 * Everywhere else it opens a new tab, because the picker sheet's links are
 * plain <a target="_blank"> and one green icon must not behave two ways: a
 * same-tab navigation would throw away the search text and the current view on
 * the thirteen customers who have exactly one number. Falls back to a plain
 * navigation when a popup blocker returns null.
 */
export function openExternal(url: string): void {
  const webApp = (window as unknown as {
    Telegram?: { WebApp?: { openLink?: (u: string) => void } };
  }).Telegram?.WebApp;

  if (typeof webApp?.openLink === 'function') {
    webApp.openLink(url);
    return;
  }
  const tab = window.open(url, '_blank', 'noopener,noreferrer');
  if (!tab) window.location.href = url;
}
