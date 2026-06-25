import { ImageResponse } from 'next/og';
import { getPublicSiteRequest, publicGroupId } from '@/lib/public-site';

// App favicon = the bakery's uploaded logo (single-bakery app). One dynamic
// icon (no static favicon.ico) so there's no competing <link> — the browser
// uses this deterministically. Falls back to a simple branded mark (no text,
// so no missing-font issues) when no logo is set.
export const runtime = 'nodejs';
export const revalidate = 3600;
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default async function Icon() {
  const site = await getPublicSiteRequest(publicGroupId()).catch(() => null);
  const logoUrl = site?.profile.logoUrl;

  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      if (res.ok) {
        return new Response(await res.arrayBuffer(), {
          headers: {
            'Content-Type': res.headers.get('content-type') ?? 'image/png',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } catch {
      // fall through to the generated mark
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#E7DCC4',
        }}
      >
        <div style={{ width: 38, height: 38, borderRadius: 9999, background: '#5B3A8C' }} />
      </div>
    ),
    size
  );
}
