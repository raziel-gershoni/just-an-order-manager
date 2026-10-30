import { t } from '@/lib/i18n';

export function GET() {
  const manifest = {
    name: t('kitchen.app_name'),
    short_name: t('kitchen.app_name'),
    start_url: '/kitchen',
    scope: '/kitchen',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#EFEBE2',
    theme_color: '#EFEBE2',
    lang: 'he',
    dir: 'rtl',
    icons: [
      { src: '/kitchen/icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/kitchen/icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
}
