'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useGroup } from '@/hooks/useGroup';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/miniapp/settings/catalog', label: 'קטלוג' },
  { href: '/miniapp/settings/reminders', label: 'תזכורות' },
  { href: '/miniapp/settings/site', label: 'האתר' },
  // Every customer's balance and the bakery's turnover. The other tabs show a
  // baker a reduced page; this one would have nothing to show, so it's hidden.
  { href: '/miniapp/settings/reports', label: 'דוחות', adminOnly: true },
  { href: '/miniapp/settings', label: 'הגדרות' },
];

/** Segmented tab bar that unifies the back-office (Control Center) screens. */
export function ControlCenterTabs() {
  const pathname = usePathname();
  const { activeGroupRole } = useGroup();
  const isAdmin = activeGroupRole === 'owner' || activeGroupRole === 'manager';
  const isActive = (href: string) =>
    href === '/miniapp/settings' ? pathname === '/miniapp/settings' : pathname.startsWith(href);

  return (
    <div className="mx-5 mt-3 flex gap-1 rounded-lg bg-muted p-1">
      {tabs
        .filter((tab) => !tab.adminOnly || isAdmin)
        .map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex-1 rounded-md py-2 text-center text-sm font-medium transition-colors',
              isActive(tab.href)
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </Link>
        ))}
    </div>
  );
}
