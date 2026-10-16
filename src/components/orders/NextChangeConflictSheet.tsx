'use client';

import { CalendarCheck, Repeat, type LucideIcon } from 'lucide-react';
import { useT } from '@/hooks/useLang';
import type { NextChangeSection } from '@/lib/order-next-change-types';

/** "פריטים ומחיר, הערה ויום" — the waiting change's sections, in words. */
export function sectionsLabel(t: (key: string) => string, sections: NextChangeSection[]): string {
  const words = sections.map((s) => t(`orders.next_section_${s}`));
  if (words.length < 2) return words.join('');
  // Hebrew "and" is a prefix on the last word, not a word of its own.
  return `${words.slice(0, -1).join(', ')} ו${words[words.length - 1]}`;
}

/**
 * Asked on saving a plain edit of a recurring order only when the edit touches
 * something a waiting "from next time" change also sets. Then the edit is
 * genuinely two-way: "from now on 4" means the plan should follow it, "this
 * week only one more" means the plan should stand. Each row is the save.
 */
export function NextChangeConflictSheet({
  date,
  sections,
  onPick,
  onClose,
}: {
  /** When the waiting change starts, already formatted; null when it isn't known yet. */
  date: string | null;
  sections: NextChangeSection[];
  onPick: (follow: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const words = sectionsLabel(t, sections);
  const title = date ? t('orders.next_conflict_title').replace('{date}', date) : t('orders.next_conflict_title_undated');
  const options: { follow: boolean; icon: LucideIcon; label: string; hint: string }[] = [
    {
      follow: true,
      icon: Repeat,
      label: date ? t('orders.next_conflict_follow').replace('{date}', date) : t('orders.next_conflict_follow_undated'),
      hint: t('orders.next_conflict_follow_hint').replace('{sections}', words),
    },
    {
      follow: false,
      icon: CalendarCheck,
      label: t('orders.next_conflict_keep'),
      hint: date ? t('orders.next_conflict_keep_hint').replace('{date}', date) : t('orders.next_conflict_keep_hint_undated'),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="w-full rounded-t-2xl border-t border-border bg-card pb-[calc(1rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-sm font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">{t('orders.next_conflict_sub').replace('{sections}', words)}</p>
        </div>
        <div className="px-2 pb-2">
          {options.map((o) => (
            <button
              key={String(o.follow)}
              type="button"
              onClick={() => onPick(o.follow)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-start transition-colors hover:bg-muted/50"
            >
              <o.icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
