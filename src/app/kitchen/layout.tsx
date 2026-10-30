import type { Metadata, Viewport } from 'next';
import { SHEET_CSS } from '@/app/print/orders/sheet-css';
import { KITCHEN_CSS } from './kitchen-css';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: t('kitchen.app_name'),
  manifest: '/kitchen/manifest.webmanifest',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EFEBE2' },
    { media: '(prefers-color-scheme: dark)', color: '#15120E' },
  ],
};

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{SHEET_CSS + KITCHEN_CSS}</style>
      {children}
    </>
  );
}
