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

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<TelegramContext>({
    initDataRaw: null,
    user: null,
    ready: false,
  });

  useEffect(() => {
    const webApp = (window as any).Telegram?.WebApp;
    if (!webApp) {
      // Not inside Telegram — dev mode fallback
      setCtx({ initDataRaw: null, user: null, ready: true });
      return;
    }

    webApp.ready();
    webApp.expand();

    const initDataRaw = webApp.initData || null;
    const tgUser = webApp.initDataUnsafe?.user;

    setCtx({
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
    });
  }, []);

  return <TelegramCtx.Provider value={ctx}>{children}</TelegramCtx.Provider>;
}
