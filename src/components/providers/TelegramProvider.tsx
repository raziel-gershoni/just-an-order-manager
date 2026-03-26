'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

interface TelegramContext {
  initDataRaw: string | null;
  user: {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
  } | null;
  ready: boolean;
}

const TelegramCtx = createContext<TelegramContext>({
  initDataRaw: null,
  user: null,
  ready: false,
});

export function useTelegram() {
  return useContext(TelegramCtx);
}

function tryInitTelegram(): TelegramContext | null {
  const webApp = (window as any).Telegram?.WebApp;
  if (!webApp) return null;

  webApp.ready();
  webApp.expand();

  const initDataRaw = webApp.initData || null;
  const tgUser = webApp.initDataUnsafe?.user;

  return {
    initDataRaw,
    user: tgUser
      ? {
          id: tgUser.id,
          firstName: tgUser.first_name,
          lastName: tgUser.last_name,
          username: tgUser.username,
        }
      : null,
    ready: true,
  };
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<TelegramContext>({
    initDataRaw: null,
    user: null,
    ready: false,
  });

  useEffect(() => {
    // Try immediately (script may already be loaded)
    const result = tryInitTelegram();
    if (result) {
      setCtx(result);
      return;
    }

    // Script not loaded yet — poll briefly for it
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const result = tryInitTelegram();
      if (result) {
        clearInterval(interval);
        setCtx(result);
      } else if (attempts >= 20) {
        // After 2 seconds, give up — not inside Telegram
        clearInterval(interval);
        setCtx({ initDataRaw: null, user: null, ready: true });
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return <TelegramCtx.Provider value={ctx}>{children}</TelegramCtx.Provider>;
}
