'use client';

import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type OverrideTier = {
  id: number;
  breadSizeId: number;
  breadTypeId: number | null;
  minQty: number;
  price: string;
};

export type OverrideSize = {
  id: number;
  name: string;
  weightGrams: number | null;
  enabled: boolean;
};

/** One row's identity in the draft map: a (size, quantity) pair. */
export function tierKey(sizeId: number, minQty: number): string {
  return `${sizeId}|${minQty}`;
}

/**
 * Per-bread override "ledger": for each enabled size carrying default tiers,
 * each tier shows its default price with an optional per-bread override. Empty
 * inherits the default (shown as the placeholder); a value overrides it and
 * lights the row in the primary accent.
 *
 * Fully controlled. It used to write on blur, which meant a tap outside the
 * field saved while everything around it waited for a button — the sheet's
 * worst inconsistency. The draft now belongs to the section, which saves it
 * like every other section does.
 */
export function TierOverrideEditor({
  sizes,
  tiers,
  draft,
  onChange,
  t,
}: {
  sizes: OverrideSize[];
  tiers: OverrideTier[];
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
  t: (key: string) => string;
}) {
  const groups = tierGroups(sizes, tiers);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="text-[11px] text-muted-foreground/70">{t('catalog.tier_overrides_hint')}</div>
      {groups.map(({ size, defaults }) => (
        <div key={size.id} className="space-y-1.5">
          {groups.length > 1 && (
            <div className="text-xs font-semibold text-foreground/80">
              {size.name}
              {size.weightGrams != null && (
                <span dir="ltr" className="ms-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {size.weightGrams}g
                </span>
              )}
            </div>
          )}
          {defaults.map((d) => {
            const key = tierKey(size.id, d.minQty);
            const value = draft[key] ?? '';
            const overridden = value !== '' && Number(value) !== Number(d.price);
            return (
              <div
                key={key}
                className={cn(
                  'flex items-center gap-2 rounded-[10px] border px-3 py-2 transition-colors',
                  overridden ? 'border-primary/50 bg-primary/5' : 'border-border'
                )}
              >
                <span className="w-16 shrink-0 font-mono text-xs tabular-nums">
                  {t('pricing.pack_of').replace('{qty}', String(d.minQty))}
                </span>
                <span dir="ltr" className="flex-1 text-[11px] tabular-nums text-muted-foreground/70">
                  ₪{d.price}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center font-mono text-sm tabular-nums',
                    overridden ? 'font-semibold text-primary' : 'text-foreground'
                  )}
                >
                  ₪
                  <input
                    type="number"
                    inputMode="decimal"
                    value={value}
                    placeholder={d.price}
                    onChange={(e) => onChange(key, e.target.value)}
                    aria-label={`${t('pricing.pack_of').replace('{qty}', String(d.minQty))} · ₪`}
                    className="w-14 bg-transparent text-center placeholder:text-muted-foreground/40 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </span>
                <button
                  type="button"
                  onClick={() => onChange(key, '')}
                  disabled={!overridden}
                  aria-label={t('catalog.tier_revert')}
                  className={cn(
                    'shrink-0 text-muted-foreground transition-opacity hover:text-foreground',
                    overridden ? 'opacity-100' : 'pointer-events-none opacity-0'
                  )}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Enabled sizes that carry size-wide default tiers, with those defaults sorted. */
export function tierGroups(sizes: OverrideSize[], tiers: OverrideTier[]) {
  return sizes
    .filter((s) => s.enabled)
    .map((s) => ({
      size: s,
      defaults: tiers
        .filter((x) => x.breadSizeId === s.id && x.breadTypeId === null)
        .sort((a, b) => a.minQty - b.minQty),
    }))
    .filter((g) => g.defaults.length > 0);
}
