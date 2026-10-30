'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

const RETRY_MS = 30_000;

export default function KitchenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error('[kitchen] page failed to load:', error.digest ?? error.message);
    const timer = window.setInterval(() => {
      router.refresh();
      reset();
    }, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [error, reset, router]);
  return (
    <main className="notice">
      <p className="notice-body">{t('kitchen.load_failed')}</p>
    </main>
  );
}
