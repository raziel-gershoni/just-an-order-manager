'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/miniapp', label: 'home', icon: '🏠' },
  { href: '/miniapp/orders', label: 'orders', icon: '📋' },
  { href: '/miniapp/customers', label: 'customers', icon: '👥' },
  { href: '/miniapp/settings', label: 'settings', icon: '⚙️' },
] as const;

export type TabKey = (typeof tabs)[number]['label'];

export function BottomNav({ labels }: { labels: Record<TabKey, string> }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/miniapp') return pathname === '/miniapp';
    return pathname.startsWith(href);
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-black/5 bg-[var(--tg-theme-bg-color,#ffffff)]">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition-colors ${
                active
                  ? 'text-[var(--tg-theme-button-color,#3b82f6)]'
                  : 'opacity-50'
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              <span>{labels[tab.label]}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
