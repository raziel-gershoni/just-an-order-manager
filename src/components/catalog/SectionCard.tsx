'use client';

import { type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useT } from '@/hooks/useLang';
import { cn } from '@/lib/utils';

/**
 * One block of the bread sheet, and the whole of its save contract.
 *
 * The sheet used to commit three different ways at once — sizes waited for a
 * bottom button, tier overrides wrote on blur, the recipe had its own button —
 * with nothing on screen saying which. Every block now looks and behaves the
 * same: a שמור appears only when that block is dirty, and a dot on the header
 * says so even when the block is collapsed. One rule to learn: if a שמור is
 * showing, something is unsaved.
 *
 * Collapsed by default, with a summary in the header, because the sheet's other
 * problem was length: nine blocks in one scroll, five of them badge pickers.
 *
 * A section that owns its own save button (the recipe editor) passes no
 * `onSave` and reports `dirty` instead, so the header dot still tells the truth.
 */
export function SectionCard({
  title,
  summary,
  open,
  onToggle,
  dirty = false,
  saving = false,
  onSave,
  children,
}: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
  children: ReactNode;
}) {
  const t = useT();

  return (
    <section
      className={cn(
        'rounded-lg border bg-card transition-colors',
        dirty ? 'border-primary/50' : 'border-border'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-start"
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          {summary != null && (
            <span className="block truncate text-[11px] text-muted-foreground">{summary}</span>
          )}
        </span>
        {dirty && (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            {t('catalog.unsaved')}
          </span>
        )}
      </button>

      {/* Hidden, not unmounted. Two reasons: a collapsed section still has to
          report its own summary and dirty state, and unmounting would throw
          away a draft while the header dot was still promising it was there. */}
      <div className={cn('space-y-3 border-t border-border px-3 py-3', !open && 'hidden')}>
        {children}
        {onSave && dirty && (
          <Button size="sm" className="w-full" loading={saving} onClick={onSave}>
            {t('settings.save')}
          </Button>
        )}
      </div>
    </section>
  );
}
