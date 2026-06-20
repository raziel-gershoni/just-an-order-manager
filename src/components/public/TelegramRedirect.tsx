'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** When the public page is opened inside Telegram (the Mini App webview),
 *  forward to the gated app so the bot's button keeps working. No-op in a
 *  normal browser. */
export function TelegramRedirect() {
  const router = useRouter();
  useEffect(() => {
    const w = window as unknown as {
      Telegram?: { WebApp?: { initData?: string } };
    };
    if (w.Telegram?.WebApp?.initData) {
      router.replace('/miniapp');
    }
  }, [router]);
  return null;
}
