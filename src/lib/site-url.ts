/**
 * The canonical, absolute base URL of the public site (no trailing slash).
 *
 * Every SEO-critical absolute URL derives from this — canonical, og:url,
 * sitemap entries, robots host. Production sets `NEXT_PUBLIC_APP_URL` to the
 * canonical host; the hardcoded fallback guarantees those URLs still point at
 * the brand domain (never localhost, a bare relative path, or an empty
 * sitemap) on any deploy where the env var is missing.
 *
 * Canonical host: www.razeilechem.co.il — every other domain
 * (razeilechem.com, razeihalechem.co.il, razeihalechem.com, *.vercel.app, and
 * the apex/no-www variants) 301-redirects here via Vercel domain settings.
 */
export const CANONICAL_BASE_URL = 'https://www.razeilechem.co.il';

export function siteBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || CANONICAL_BASE_URL).trim();
  // Tolerate a scheme-less env value (e.g. "www.razeilechem.co.il") — Vercel
  // domain fields often omit the protocol, and a bare host throws in new URL().
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}
