'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Toaster, toast as sonnerToast } from 'sonner';
import { TelegramProvider, useTelegram } from '@/components/providers/TelegramProvider';
import { GroupCtx } from '@/hooks/useGroup';
import { ToastCtx, type Toast } from '@/hooks/useToast';
import { BottomNav } from '@/components/ui/BottomNav';
import { LangCtx } from '@/hooks/useLang';
import { t, type Lang } from '@/lib/i18n';

function AppProviders({ children }: { children: ReactNode }) {
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [lang, setLang] = useState<Lang>('he');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { initDataRaw, ready } = useTelegram();

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      const id = Date.now().toString();
      setToasts((prev) => [...prev, { id, message, type }]);
      // Also fire Sonner toast
      if (type === 'success') {
        sonnerToast.success(message);
      } else {
        sonnerToast.error(message);
      }
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (!ready) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (initDataRaw) {
      headers['Authorization'] = `tma ${initDataRaw}`;
    }

    fetch('/api/auth/me', { headers })
      .then((r) => r.json())
      .then((data) => {
        if (data.user?.language) {
          setLang(data.user.language);
        }
        if (data.groups?.length > 0) {
          setActiveGroupId(data.groups[0].id);
        }
      })
      .catch(() => {});
  }, [ready, initDataRaw]);

  const dir = lang === 'he' ? 'rtl' : 'ltr';

  return (
    <LangCtx.Provider value={lang}>
      <ToastCtx.Provider value={{ toasts, showToast, dismissToast }}>
        <GroupCtx.Provider value={{ activeGroupId, setActiveGroupId }}>
          <div
            dir={dir}
            className="min-h-screen bg-background text-foreground"
          >
            <Toaster
              position="top-center"
              toastOptions={{
                className: 'font-sans',
                style: {
                  borderRadius: '0.75rem',
                },
              }}
            />
            <div className="pb-20 animate-fade-in">{children}</div>
            <BottomNav
              labels={{
                home: t('nav.home', lang),
                orders: t('nav.orders', lang),
                customers: t('nav.customers', lang),
                settings: t('nav.settings', lang),
              }}
            />
          </div>
        </GroupCtx.Provider>
      </ToastCtx.Provider>
    </LangCtx.Provider>
  );
}

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return (
    <TelegramProvider>
      <AppProviders>{children}</AppProviders>
    </TelegramProvider>
  );
}
