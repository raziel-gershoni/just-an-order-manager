import type { Metadata, Viewport } from 'next';
import { getPublicSiteRequest, publicGroupId } from '@/lib/public-site';
import { siteBaseUrl } from '@/lib/site-url';

// Public marketing surface: indexable + zoom-enabled (overrides the root
// layout's noindex + locked viewport, which stay in force for /miniapp).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#E7DCC4', // kraft — mobile browser chrome matches the page
};

const BASE_URL = siteBaseUrl();

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteRequest(publicGroupId());
  const metadataBase = new URL(BASE_URL);

  if (!site) {
    return { metadataBase, robots: { index: false, follow: false } };
  }
  const { profile } = site;
  const title = profile.displayName;
  const description =
    profile.tagline ?? profile.heroHeadline ?? 'מאפיית מחמצת ביתית';
  return {
    metadataBase,
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: '/' },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: 'he_IL',
      siteName: title,
      url: BASE_URL,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
