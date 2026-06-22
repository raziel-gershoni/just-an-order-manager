import { readFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';
import { getPublicSiteRequest, publicGroupId } from '@/lib/public-site';

// Generated link-preview card for the public bakery site. Drawn with a
// bundled Assistant font so Hebrew renders (Satori has no system fonts →
// otherwise Hebrew becomes tofu boxes).
export const runtime = 'nodejs';
// Mirror the public page's ISR so the card refreshes with the bakery name.
export const revalidate = 3600;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'מאפיית מחמצת';

const KRAFT = '#E7DCC4';
const CARD = '#F1E9D6';
const INK = '#241F1A';
const MUTED = '#6B5E4A';
const PRIMARY = '#5B3A8C';
const BORDER = '#D6C8A8';

async function font(file: string): Promise<Buffer> {
  // fs (not fetch) so it works on the Node runtime; the URL is traced into
  // the function bundle for production.
  return readFile(new URL(`./og-fonts/${file}`, import.meta.url));
}

export default async function OpengraphImage() {
  const site = await getPublicSiteRequest(publicGroupId()).catch(() => null);
  const name = site?.profile.displayName?.trim() || 'מאפיית מחמצת';
  const tagline =
    site?.profile.tagline?.trim() || site?.profile.heroHeadline?.trim() || 'לחם מחמצת אמיתי, נאפה טרי';
  const initial = name[0] ?? 'מ';

  const [heb700, lat700, heb600, lat600] = await Promise.all([
    font('assistant-heb-700.woff'),
    font('assistant-lat-700.woff'),
    font('assistant-heb-600.woff'),
    font('assistant-lat-600.woff'),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: KRAFT,
          padding: 56,
          fontFamily: 'Assistant',
        }}
      >
        <div
          style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            background: CARD,
            border: `1px solid ${BORDER}`,
          }}
        >
          {/* color stub + perforation, like a docket ticket */}
          <div
            style={{
              width: 132,
              background: PRIMARY,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: 9999,
                background: CARD,
                color: PRIMARY,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 46,
                fontWeight: 700,
              }}
            >
              {initial}
            </div>
          </div>
          {/* dashed perforation between stub and body */}
          <div
            style={{
              width: 0,
              borderLeft: `3px dashed ${KRAFT}`,
              marginLeft: -2,
            }}
          />

          {/* body */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 72px',
              direction: 'rtl',
            }}
          >
            <div
              style={{
                fontFamily: 'Assistant',
                fontSize: 27,
                fontWeight: 600,
                letterSpacing: 8,
                color: MUTED,
                direction: 'ltr',
                marginBottom: 22,
              }}
            >
              NATURALLY LEAVENED
            </div>
            <div style={{ fontSize: 90, fontWeight: 700, color: INK, lineHeight: 1.04 }}>{name}</div>
            <div style={{ fontSize: 40, fontWeight: 600, color: PRIMARY, marginTop: 22 }}>{tagline}</div>
          </div>

          {/* rubber stamp */}
          <div
            style={{
              position: 'absolute',
              top: 44,
              left: 168,
              display: 'flex',
              transform: 'rotate(-7deg)',
              border: `3px solid ${PRIMARY}`,
              borderRadius: 8,
              color: PRIMARY,
              fontSize: 26,
              fontWeight: 700,
              padding: '7px 18px',
              direction: 'rtl',
            }}
          >
            טרי מהתנור
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Assistant', data: heb700, weight: 700, style: 'normal' },
        { name: 'Assistant', data: lat700, weight: 700, style: 'normal' },
        { name: 'Assistant', data: heb600, weight: 600, style: 'normal' },
        { name: 'Assistant', data: lat600, weight: 600, style: 'normal' },
      ],
    }
  );
}
