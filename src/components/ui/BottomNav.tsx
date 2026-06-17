'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ClipboardList, Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/miniapp', label: 'home', icon: Home },
  { href: '/miniapp/orders', label: 'orders', icon: ClipboardList },
  { href: '/miniapp/customers', label: 'customers', icon: Users },
  { href: '/miniapp/settings', label: 'settings', icon: Settings },
] as const;

export type TabKey = (typeof tabs)[number]['label'];

export function BottomNav({ labels }: { labels: Record<TabKey, string> }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/miniapp') return pathname === '/miniapp';
    return pathname.startsWith(href);
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-dashed border-border bg-card/80 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs transition-colors rounded-lg',
                active
                  ? 'text-primary font-medium'
                  : 'text-muted-foreground'
              )}
            >
              {active && (
                <span className="absolute -top-px left-1/2 -translate-x-1/2 h-[3px] w-7 rounded-b-full bg-primary" />
              )}
              <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} />
              <span>{labels[tab.label]}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
