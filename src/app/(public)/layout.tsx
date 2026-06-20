import type { Metadata, Viewport } from 'next';
import { getPublicSiteRequest, publicGroupId } from '@/lib/public-site';

// Public marketing surface: indexable + zoom-enabled (overrides the root
// layout's noindex + locked viewport, which stay in force for /miniapp).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteRequest(publicGroupId());
  if (!site) {
    return { robots: { index: false, follow: false } };
  }
  const { profile } = site;
  const title = profile.displayName;
  const description =
    profile.tagline ?? profile.heroHeadline ?? 'מאפיית מחמצת ביתית';
  return {
    title,
    description,
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: 'he_IL',
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
