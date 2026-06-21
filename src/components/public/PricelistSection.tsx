'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { PublicBread } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';
import { PublicBadge } from './PublicBadge';
import { DocketStub, docketWidth } from '@/components/ui/DocketStub';

export function PricelistSection({
  catalog,
  additionsSurcharge,
}: {
  catalog: PublicBread[];
  additionsSurcharge: number;
}) {
  const idWidth = docketWidth(catalog.map((b) => b.id));
  return (
    <section className="mt-10">
      <PublicSectionHead label={t('site.pricelist')} meta={t('site.prices_note')} />
      <div className="space-y-2.5">
        {catalog.map((bread) => (
          <PricelistTicket
            key={bread.id}
            bread={bread}
            idWidth={idWidth}
            surcharge={additionsSurcharge}
          />
        ))}
      </div>
    </section>
  );
}

function PricelistTicket({
  bread,
  idWidth,
  surcharge,
}: {
  bread: PublicBread;
  idWidth: number;
  surcharge: number;
}) {
  const [open, setOpen] = useState(false);
  const multi = bread.sizes.length > 1;
  const fromPrice = bread.sizes[0]?.price; // sizes already sorted low → high

  return (
    <div className="flex items-stretch overflow-hidden rounded-[10px] border border-border bg-card shadow-[0_6px_18px_-16px_rgba(36,31,26,0.5)]">
      <DocketStub id={bread.id} width={idWidth} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 px-3.5 py-3 text-start"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-display text-[16px] font-semibold">
            <span className="truncate">{bread.name}</span>
            {bread.badge && <PublicBadge badge={bread.badge} small />}
          </span>
          {fromPrice && (
            <span className="whitespace-nowrap font-mono text-[13px] font-bold text-primary">
              {multi && <span className="font-semibold text-muted-foreground">{t('site.from_price')}</span>}₪
              {fromPrice}
            </span>
          )}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {bread.description && (
          <div className="-mt-1 px-3.5 pb-2.5 text-[12.5px] leading-snug text-muted-foreground">
            {bread.description}
          </div>
        )}

        {open && (
          <div>
            <div className="border-t-[1.5px] border-dashed border-border">
              {bread.sizes.map((s, i) => (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center justify-between gap-2 px-3.5 py-2 text-[13.5px]',
                    i > 0 && 'border-t border-dashed border-border'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold">{s.name}</span>
                    {s.weightGrams != null && (
                      <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
                        {s.weightGrams} {t('site.grams')}
                      </span>
                    )}
                    {s.badge && <PublicBadge badge={s.badge} small />}
                  </span>
                  <span className="font-mono font-bold tabular-nums">₪{s.price}</span>
                </div>
              ))}
            </div>

            {bread.additions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t-[1.5px] border-dashed border-border bg-secondary/30 px-3.5 py-2.5 text-[12px]">
                <span className="font-semibold text-muted-foreground">{t('site.additions_label')}</span>
                {bread.additions.map((a) => (
                  <span
                    key={a}
                    className="rounded-[5px] border border-border bg-secondary px-1.5 py-0.5 font-semibold"
                  >
                    {a}
                  </span>
                ))}
                {surcharge > 0 && (
                  <span className="ms-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                    ₪{surcharge} {t('site.per_addition')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
