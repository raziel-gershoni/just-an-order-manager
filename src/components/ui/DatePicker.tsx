'use client';

import { useEffect, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { he } from 'react-day-picker/locale/he';
import { format, parseISO } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '@/hooks/useLang';
import { formatDateLong, todayStr } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

/**
 * The app's date picker: a button showing the date in words that opens a
 * right-to-left Hebrew month calendar in a bottom sheet. It replaces the native
 * `<input type="date">`, whose calendar follows the device, not the page, and
 * stays left-to-right even on a Hebrew phone.
 *
 * Dates go in and out as `yyyy-MM-dd` strings, like the input it replaces.
 */
export function DatePicker({
  value,
  onChange,
  min,
  bare,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  /** The earliest day that can be picked, `yyyy-MM-dd`. */
  min?: string;
  /** No field border — for a picker sitting between its own arrow buttons. */
  bare?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const today = todayStr();
  const selected = value ? parseISO(value) : undefined;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'flex min-w-0 items-center gap-2 text-base',
          bare
            ? 'justify-center font-medium'
            : 'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-start outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20',
          className
        )}
      >
        {!bare && <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />}
        {/* A bare picker waiting for its screen's date shows nothing rather than a placeholder. */}
        <span className={cn('truncate', !value && 'text-muted-foreground/60')}>
          {value ? formatDateLong(value) : bare ? '\u00a0' : t('form.pick_date')}
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 animate-fade-in" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label={t('form.pick_date')}
            className="w-full rounded-t-2xl border-t border-border bg-card px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <DayPicker
              mode="single"
              required
              dir="rtl"
              locale={he}
              weekStartsOn={0}
              today={parseISO(today)}
              selected={selected}
              defaultMonth={selected ?? (min ? parseISO(min) : parseISO(today))}
              startMonth={min ? parseISO(min) : undefined}
              disabled={min ? { before: parseISO(min) } : undefined}
              onSelect={(d) => {
                onChange(format(d, 'yyyy-MM-dd'));
                setOpen(false);
              }}
              showOutsideDays
              fixedWeeks
              autoFocus
              components={{
                // DayPicker's default nav names the previous button "left" and the
                // next "right" whatever the direction; in RTL previous sits on the
                // right and points right, as the app's own day arrows do.
                Chevron: ({ orientation }) =>
                  orientation === 'left' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />,
              }}
              classNames={{
                root: 'relative mx-auto w-full max-w-sm',
                months: 'w-full',
                month: 'w-full space-y-2',
                month_caption: 'flex h-10 items-center justify-center',
                caption_label: 'text-base font-bold',
                nav: 'absolute inset-x-0 top-0 flex h-10 items-center justify-between',
                button_previous:
                  'flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-30',
                button_next:
                  'flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-30',
                month_grid: 'w-full border-collapse',
                weekdays: '',
                weekday: 'h-8 text-xs font-semibold text-muted-foreground',
                week: '',
                day: 'p-0.5 text-center',
                // rounded-full! beats the global :focus-visible radius; 2.25rem on
                // a 320px phone keeps seven days inside the sheet.
                day_button:
                  'mx-auto flex h-9 w-9 min-[360px]:h-10 min-[360px]:w-10 items-center justify-center rounded-full! text-sm tabular-nums transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
                today: '[&>button]:font-bold [&>button]:ring-1 [&>button]:ring-primary',
                // The chosen day wins over today's ring and an outside day's grey.
                selected:
                  '[&>button]:bg-primary [&>button]:text-primary-foreground! [&>button]:ring-0! [&>button]:hover:bg-primary',
                outside: '[&>button]:text-muted-foreground/50',
                disabled: '[&>button]:pointer-events-none [&>button]:opacity-30',
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
