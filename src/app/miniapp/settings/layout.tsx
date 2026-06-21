'use client';

import { type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useGroup } from '@/hooks/useGroup';

/**
 * Back-office shell. Shows the "מצב ניהול" (admin mode) eyebrow for owners/managers.
 * The dark theme itself is applied one level up (miniapp/layout) for the same audience.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { activeGroupRole } = useGroup();
  const isAdmin = (activeGroupRole === 'owner' || activeGroupRole === 'manager');

  return (
    <>
      {isAdmin && (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="font-medium tracking-wide">מצב ניהול</span>
          <span className="text-muted-foreground/60">· הגדרות העסק</span>
        </div>
      )}
      {children}
    </>
  );
}
