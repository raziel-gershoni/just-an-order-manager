'use client';

import { useEffect, useState } from 'react';
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

// Per-bread override "ledger": for each enabled size that carries default tiers,
// each tier shows its default price with an optional per-bread override. An empty
// field inherits the default (shown as the placeholder); a value overrides it and
// lights the row in the primary accent.
export function TierOverrideEditor({
  sizes,
  tiers,
  breadTypeId,
  onSave,
  onDelete,
  t,
}: {
  sizes: OverrideSize[];
  tiers: OverrideTier[];
  breadTypeId: number;
  onSave: (breadSizeId: number, minQty: number, price: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  t: (key: string) => string;
}) {
  const groups = sizes
    .filter((s) => s.enabled)
    .map((s) => ({
      size: s,
      defaults: tiers
        .filter((x) => x.breadSizeId === s.id && x.breadTypeId === null)
        .sort((a, b) => a.minQty - b.minQty),
    }))
    .filter((g) => g.defaults.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="mt-3 space-y-2.5 border-t border-dashed border-border pt-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground">{t('catalog.tier_overrides')}</div>
        <div className="text-[11px] text-muted-foreground/70">{t('catalog.tier_overrides_hint')}</div>
      </div>
      {groups.map(({ size, defaults }) => (
        <div key={size.id} className="space-y-1.5">
          {groups.length > 1 && (
            <div className="text-xs font-semibold text-foreground/80">
              {size.name}
              {size.weightGrams != null && (
                <span className="ms-1 font-mono text-[10px] text-muted-foreground tabular-nums">{size.weightGrams}g</span>
              )}
            </div>
          )}
          {defaults.map((d) => (
            <TierOverrideRow
              key={d.minQty}
              sizeId={size.id}
              minQty={d.minQty}
              defaultPrice={d.price}
              override={tiers.find(
                (x) => x.breadSizeId === size.id && x.breadTypeId === breadTypeId && x.minQty === d.minQty
              )}
              onSave={onSave}
              onDelete={onDelete}
              t={t}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TierOverrideRow({
  sizeId,
  minQty,
  defaultPrice,
  override,
  onSave,
  onDelete,
  t,
}: {
  sizeId: number;
  minQty: number;
  defaultPrice: string;
  override: OverrideTier | undefined;
  onSave: (breadSizeId: number, minQty: number, price: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  t: (key: string) => string;
}) {
  const [val, setVal] = useState(override?.price ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setVal(override?.price ?? '');
  }, [override?.price]);

  const isOverridden = (override?.price ?? '') !== '';

  async function commit() {
    const trimmed = val.trim();
    // Blank or equal to the default → inherit (drop any override).
    if (trimmed === '' || Number(trimmed) === Number(defaultPrice)) {
      if (override) {
        setBusy(true);
        try { await onDelete(override.id); } finally { setBusy(false); }
      }
      setVal('');
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      setVal(override?.price ?? ''); // invalid → revert
      return;
    }
    if (trimmed === override?.price) return; // unchanged
    setBusy(true);
    try { await onSave(sizeId, minQty, trimmed); } finally { setBusy(false); }
  }

  async function revert() {
    if (override) {
      setBusy(true);
      try { await onDelete(override.id); } finally { setBusy(false); }
    }
    setVal('');
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[10px] border px-3 py-2 transition-colors',
        isOverridden ? 'border-primary/50 bg-primary/5' : 'border-border'
      )}
    >
      <span className="w-16 shrink-0 font-mono text-xs tabular-nums">
        {t('pricing.pack_of').replace('{qty}', String(minQty))}
      </span>
      <span className="flex-1 text-[11px] tabular-nums text-muted-foreground/70">
        {t('catalog.tier_default_price')} ₪{defaultPrice}
      </span>
      <span
        className={cn(
          'inline-flex items-center font-mono text-sm tabular-nums',
          isOverridden ? 'font-semibold text-primary' : 'text-foreground'
        )}
      >
        ₪
        <input
          type="number"
          inputMode="decimal"
          value={val}
          placeholder={defaultPrice}
          disabled={busy}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label={`${t('pricing.pack_of').replace('{qty}', String(minQty))} · ₪`}
          className="w-14 bg-transparent text-center placeholder:text-muted-foreground/40 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </span>
      <button
        type="button"
        onClick={revert}
        disabled={!isOverridden || busy}
        aria-label={t('catalog.tier_revert')}
        className={cn(
          'shrink-0 text-muted-foreground transition-opacity hover:text-foreground',
          isOverridden ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
