'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/miniapp/settings/catalog', label: 'קטלוג' },
  { href: '/miniapp/settings/reminders', label: 'תזכורות' },
  { href: '/miniapp/settings', label: 'הגדרות' },
];

/** Segmented tab bar that unifies the back-office (Control Center) screens. */
export function ControlCenterTabs() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/miniapp/settings' ? pathname === '/miniapp/settings' : pathname.startsWith(href);

  return (
    <div className="mx-5 mt-3 flex gap-1 rounded-lg bg-muted p-1">
      {tabs.map((tab) => (
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
