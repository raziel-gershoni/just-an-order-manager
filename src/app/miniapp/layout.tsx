'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { TelegramProvider, useTelegram } from '@/components/providers/TelegramProvider';
import { GroupCtx } from '@/hooks/useGroup';

function GroupProvider({ children }: { children: ReactNode }) {
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const { initDataRaw, ready } = useTelegram();

  useEffect(() => {
    if (!ready) return;

    // Fetch user's groups and set the first one as active
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (initDataRaw) {
      headers['Authorization'] = `tma ${initDataRaw}`;
    }

    fetch('/api/auth/me', { headers })
      .then((r) => r.json())
      .then((data) => {
        if (data.groups?.length > 0) {
          setActiveGroupId(data.groups[0].id);
        }
      })
      .catch(() => {});
  }, [ready, initDataRaw]);

  return (
    <GroupCtx.Provider value={{ activeGroupId, setActiveGroupId }}>
      {children}
    </GroupCtx.Provider>
  );
}

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return (
    <TelegramProvider>
      <GroupProvider>
        <div className="min-h-screen bg-[var(--tg-theme-bg-color,#ffffff)] text-[var(--tg-theme-text-color,#000000)]">
          {children}
        </div>
      </GroupProvider>
    </TelegramProvider>
  );
}
