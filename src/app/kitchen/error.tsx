'use client';

import { useEffect } from 'react';
import { useKeepAwake } from '@/hooks/useKeepAwake';
import { t } from '@/lib/i18n';

const RETRY_MS = 30_000;

// unstable_retry re-fetches the page and re-renders it (Next's documented way
// to recover; reset alone would only re-render the same failed result).
export default function KitchenError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  // A failed load must not let the screen go dark: nobody is there to wake it.
  useKeepAwake();
  useEffect(() => {
    console.error('[kitchen] page failed to load:', error.digest ?? error.message);
    const timer = window.setInterval(unstable_retry, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [error, unstable_retry]);
  return (
    <main className="notice">
      <p className="notice-body">{t('kitchen.load_failed')}</p>
    </main>
  );
}
