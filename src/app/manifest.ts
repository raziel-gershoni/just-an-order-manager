import type { MetadataRoute } from 'next';
import { getPublicSiteRequest, publicGroupId } from '@/lib/public-site';

export const revalidate = 3600;

// Web app manifest — name/icons/colors for Add-to-Home-Screen and the PWA
// install surface. Reads the published bakery name; falls back to the brand.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const site = await getPublicSiteRequest(publicGroupId()).catch(() => null);
  const name = site?.profile.displayName ?? 'רזי הלחם';
  const tagline = site?.profile.tagline?.trim();

  return {
    name,
    short_name: name,
    ...(tagline ? { description: tagline } : {}),
    start_url: '/',
    display: 'standalone',
    background_color: '#E7DCC4',
    theme_color: '#E7DCC4',
    lang: 'he',
    dir: 'rtl',
    icons: [{ src: '/icon', sizes: '96x96', type: 'image/png' }],
  };
}
