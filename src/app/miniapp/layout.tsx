'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Script from 'next/script';
import { Toaster, toast as sonnerToast } from 'sonner';
import { TelegramProvider, useTelegram } from '@/components/providers/TelegramProvider';
import { GroupCtx, type GroupRole } from '@/hooks/useGroup';
import { ToastCtx, type Toast } from '@/hooks/useToast';
import { BottomNav } from '@/components/ui/BottomNav';
import { LoadingSplash } from '@/components/ui/LoadingSplash';
import { LangCtx } from '@/hooks/useLang';
import { t, type Lang } from '@/lib/i18n';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

function AppProviders({ children }: { children: ReactNode }) {
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [activeGroupRole, setActiveGroupRole] = useState<GroupRole | null>(null);
  const [lang, setLang] = useState<Lang>('he');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authResolved, setAuthResolved] = useState(false);
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
          setActiveGroupRole(data.groups[0].role ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setAuthResolved(true));
  }, [ready, initDataRaw]);

  const dir = 'rtl';
  // Dark "back-office" theme: owner/manager in the settings/catalog area. Bakers stay light.
  const pathname = usePathname();
  const isBackOffice = pathname?.startsWith('/miniapp/settings') ?? false;
  const dark = isBackOffice && activeGroupRole !== null && activeGroupRole !== 'baker';

  return (
    <LangCtx.Provider value={lang}>
      <ToastCtx.Provider value={{ toasts, showToast, dismissToast }}>
        <GroupCtx.Provider value={{ activeGroupId, activeGroupRole, setActiveGroupId, setActiveGroupRole }}>
          <div
            dir={dir}
            className={cn('min-h-screen bg-background text-foreground', dark && 'theme-dark')}
          >
            {/* Telegram Mini App SDK — only loaded inside the gated app, not on
                the public site. The provider polls for window.Telegram (~2s). */}
            <Script
              src="https://telegram.org/js/telegram-web-app.js"
              strategy="afterInteractive"
            />
            <Toaster
              position="top-center"
              toastOptions={{
                className: 'font-sans',
                style: {
                  borderRadius: '0.75rem',
                },
              }}
            />
            {!authResolved ? (
              <LoadingSplash />
            ) : (
              <>
                <div className="pb-20 animate-fade-in">{children}</div>
                <BottomNav
                  labels={{
                    home: t('nav.home', lang),
                    orders: t('nav.orders', lang),
                    customers: t('nav.customers', lang),
                    settings: t('nav.settings', lang),
                  }}
                />
              </>
            )}
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
