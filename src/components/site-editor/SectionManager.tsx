'use client';

import { ChevronUp, ChevronDown, Eye, EyeOff } from 'lucide-react';
import type { SectionConfig } from '@/db/schema';
import { useT } from '@/hooks/useLang';

/** Reorder (↑/↓) + show/hide the public site's sections. Presentational —
 *  the parent owns the array and persistence. */
export function SectionManager({
  sections,
  labels,
  emptyKeys,
  onChange,
}: {
  sections: SectionConfig[];
  labels: Record<string, string>;
  emptyKeys: Set<string>;
  onChange: (next: SectionConfig[]) => void;
}) {
  const t = useT();

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const toggle = (i: number) =>
    onChange(sections.map((s, idx) => (idx === i ? { ...s, visible: !s.visible } : s)));

  return (
    <div className="divide-y divide-dashed divide-border">
      {sections.map((s, i) => {
        const isEmpty = emptyKeys.has(s.key);
        return (
          <div key={s.key} className="flex items-center gap-2.5 py-2.5">
            <div className="flex flex-col text-muted-foreground">
              <button
                type="button"
                aria-label="up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="disabled:opacity-25 hover:text-foreground"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="down"
                disabled={i === sections.length - 1}
                onClick={() => move(i, 1)}
                className="disabled:opacity-25 hover:text-foreground"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <div className={'font-medium ' + (s.visible ? '' : 'opacity-40')}>
                {labels[s.key] ?? s.key}
              </div>
              {s.visible && isEmpty && (
                <div className="text-[11px] text-warning">{t('site.section_hidden_empty')}</div>
              )}
            </div>

            <button
              type="button"
              aria-label="toggle"
              onClick={() => toggle(i)}
              className={s.visible ? 'text-foreground' : 'text-muted-foreground'}
            >
              {s.visible ? <Eye className="h-[18px] w-[18px]" /> : <EyeOff className="h-[18px] w-[18px]" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
