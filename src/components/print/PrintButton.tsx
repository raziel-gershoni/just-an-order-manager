'use client';

import { Printer } from 'lucide-react';
import { t } from '@/lib/i18n';

/**
 * Opens the browser's print dialog — which is also how you get a PDF, via its
 * "Save as PDF" destination. Deliberately the only client-side code on the
 * sheet; date picking is a plain GET form so the page works with JS disabled.
 *
 * Does nothing inside a WebView (Telegram included) — `window.print()` is a
 * no-op there — so the page has to be opened in a real browser to print. The
 * Mini App's button opens it externally for that reason.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      className="print-btn"
      onClick={() => window.print()}
      aria-label={t('print.print')}
      title={t('print.print')}
    >
      <Printer aria-hidden="true" width={18} height={18} strokeWidth={2.25} />
    </button>
  );
}
