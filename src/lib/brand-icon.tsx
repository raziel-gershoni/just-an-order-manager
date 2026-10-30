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

  return brandMarkResponse(size);
}

/** The text-free generated mark (purple dot on kraft) at exactly `size`. */
export function brandMarkResponse(size: { width: number; height: number }): Response {
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

// The og renderer reads PNG and JPEG (also GIF/SVG, not WebP/AVIF), so the logo
// is recognised by its bytes, not by the content-type its host claims.
function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * A square PNG of exactly `size` for places that insist on one (the kitchen
 * screen's home-screen icon): the bakery logo contained and centred on the
 * sheet's paper colour, or the generated mark when there is no logo or the
 * logo is not an image the renderer can draw. Unlike brandIconResponse it
 * never passes the logo's own bytes through, so the size is always right.
 */
export async function squareBrandIconResponse(size: number): Promise<Response> {
  const dims = { width: size, height: size };
  const site = await getPublicSiteRequest(publicGroupId()).catch((err) => {
    console.warn('[kitchen] icon: reading the public site failed:', err);
    return null;
  });
  const logoUrl = site?.profile.logoUrl;
  if (!logoUrl) return brandMarkResponse(dims);
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) throw new Error(`logo fetch answered ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = imageMime(bytes);
    if (!mime) {
      console.warn(`[kitchen] icon: the logo is not a PNG or JPEG (${res.headers.get('content-type') ?? 'unknown type'}); using the generated mark`);
      return brandMarkResponse(dims);
    }
    // Rendered here, not streamed out, so a logo the renderer chokes on falls back instead of failing mid-response.
    const png = await new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#EFEBE2', padding: Math.round(size * 0.1) }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered by satori, not the browser */}
          <img src={`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      ),
      dims
    ).arrayBuffer();
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } });
  } catch (err) {
    console.warn('[kitchen] icon: drawing the logo failed; using the generated mark:', err);
    return brandMarkResponse(dims);
  }
}
