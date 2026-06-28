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
  return (process.env.NEXT_PUBLIC_APP_URL || CANONICAL_BASE_URL).replace(/\/$/, '');
}
