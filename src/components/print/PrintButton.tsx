'use client';

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
    <button type="button" className="print-btn" onClick={() => window.print()}>
      הדפסה
    </button>
  );
}
