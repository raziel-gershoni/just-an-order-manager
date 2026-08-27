import { normalizePhoneNumber } from './whatsapp';

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
 * but hands the user a one-way trip out of the mini app. Everywhere else, and
 * this app is meant to work in any browser, a plain navigation is the whole
 * story. Never window.open: nothing else in this codebase uses it and its
 * behaviour in the Telegram WebView is the least predictable of the three.
 */
export function openExternal(url: string): void {
  const webApp = (window as unknown as {
    Telegram?: { WebApp?: { openLink?: (u: string) => void } };
  }).Telegram?.WebApp;

  if (typeof webApp?.openLink === 'function') {
    webApp.openLink(url);
    return;
  }
  window.location.href = url;
}
