import { ImageResponse } from 'next/og';
import { getPublicSiteRequest, publicGroupId } from '@/lib/public-site';

/**
 * Serve the bakery's uploaded logo as a square icon, falling back to a
 * text-free branded mark (purple dot on kraft — no font, so no tofu) when no
 * logo is set. Shared by app/icon (favicon) and app/apple-icon.
 */
export async function brandIconResponse(size: {
  width: number;
  height: number;
}): Promise<Response> {
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

  const dot = Math.round(size.width * 0.6);
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
        <div style={{ width: dot, height: dot, borderRadius: 9999, background: '#5B3A8C' }} />
      </div>
    ),
    size
  );
}
