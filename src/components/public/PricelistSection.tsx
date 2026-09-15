'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { PublicBread, PublicDeal } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';
import { PublicBadge } from './PublicBadge';

function rangeOf(bread: PublicBread): string | null {
  const sizes = bread.sizes; // sorted low → high
  if (sizes.length === 0) return null;
  const min = sizes[0].price;
  const max = sizes[sizes.length - 1].price;
  return min === max ? `₪${min}` : `₪${min}–${max}`;
}

/**
 * The bread, its picture and what it costs — a menu, not a docket.
 *
 * Every row had a coloured stub, a dashed perforation under it and monospace
 * prices; ten of them read as a ration book. What is left is the photo, the
 * name in the serif, and the price, on a hairline. A bread with no photo gets
 * its initial in the same serif rather than a hole in the column, so the names
 * still start on one line down the page.
 */
function Tile({ bread }: { bread: PublicBread }) {
  // Portrait, not square: a standing challah or a long כפרי keeps its shape
  // instead of having both ends cropped away.
  if (bread.image) {
    return (
      <span className="relative h-[78px] w-[58px] shrink-0 overflow-hidden rounded-[3px] bg-card">
        <Image src={bread.image.url} alt="" fill sizes="58px" className="object-cover" />
      </span>
    );
  }
  // No photo yet: flour dust on a board. It holds the column so the names
  // still line up, and does not pretend to be a picture.
  return <span aria-hidden className="site-notile h-[78px] w-[58px] shrink-0 rounded-[3px]" />;
}

export function PricelistSection({
  catalog,
  additionsSurcharge,
}: {
  catalog: PublicBread[];
  additionsSurcharge: number;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const openBread = openId == null ? null : catalog.find((b) => b.id === openId) ?? null;

  // Close on Escape + lock background scroll while the card is open.
  useEffect(() => {
    if (!openBread) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [openBread]);

  return (
    <section className="mt-12">
      <PublicSectionHead label={t('site.pricelist')} meta={t('site.prices_note')} />

      <div>
        {catalog.map((bread, i) => {
          const range = rangeOf(bread);
          const hasDeals = bread.sizes.some((s) => s.deals.length > 0);
          const soldOut = bread.badge?.preset === 'sold_out';
          return (
            <button
              key={bread.id}
              type="button"
              onClick={() => setOpenId(bread.id)}
              className={cn(
                'flex w-full items-center gap-3.5 py-3 text-start transition-opacity',
                i > 0 && 'border-t border-border',
                // Sold out is information, so the row says it twice: the badge
                // names it and the row steps back from the ones you can buy.
                soldOut && 'opacity-55'
              )}
            >
              <Tile bread={bread} />

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="site-display truncate text-[20px] leading-tight">
                    {bread.name}
                  </span>
                  {bread.badge && <PublicBadge badge={bread.badge} small />}
                  {hasDeals && (
                    <span className="text-[11.5px] font-bold text-primary">{t('site.deals_tag')}</span>
                  )}
                </span>
                {bread.description && (
                  <span className="mt-1 block truncate text-[13px] leading-snug text-muted-foreground">
                    {bread.description}
                  </span>
                )}
              </span>

              {range && (
                <span dir="ltr" className="site-display shrink-0 text-[19px] tabular-nums text-primary">
                  {range}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {openBread && (
        <PricelistCard bread={openBread} surcharge={additionsSurcharge} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}

function PricelistCard({
  bread,
  surcharge,
  onClose,
}: {
  bread: PublicBread;
  surcharge: number;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={bread.name}
    >
      <div className="absolute inset-0 bg-foreground/45" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[88vh] w-full max-w-[420px] overflow-y-auto rounded-t-[14px] bg-background pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-8px_40px_-12px_rgba(43,28,17,0.5)] sm:rounded-[14px] sm:pb-5"
      >
        {bread.image && (
          <div className="relative aspect-[5/3] w-full overflow-hidden rounded-t-[14px]">
            <Image
              src={bread.image.url}
              alt={bread.image.alt?.trim() || bread.name}
              fill
              sizes="(max-width: 520px) 100vw, 420px"
              className="object-cover"
            />
          </div>
        )}

        <div className="px-5 pt-4">
          <div className="flex items-center gap-2">
            <h3 className="site-display text-[26px] leading-tight">{bread.name}</h3>
            {bread.badge && <PublicBadge badge={bread.badge} />}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('payments.cancel')}
              className="ms-auto grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-card"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {bread.description && (
            <p className="mt-2 text-[14.5px] leading-[1.6] text-muted-foreground">{bread.description}</p>
          )}

          <div className="mt-4">
            {bread.sizes.map((s, i) => (
              <div key={s.id} className={cn('py-3', i > 0 && 'border-t border-border')}>
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold">{s.name}</span>
                  {s.badge && <PublicBadge badge={s.badge} small />}
                  {s.weightGrams != null && (
                    <span dir="ltr" className="text-[12.5px] tabular-nums text-muted-foreground">
                      {s.weightGrams}g
                    </span>
                  )}
                  <span dir="ltr" className="site-display ms-auto text-[19px] tabular-nums text-primary">
                    ₪{s.price}
                  </span>
                </div>
                {s.deals.map((d) => (
                  <DealRow key={d.minQty} deal={d} />
                ))}
              </div>
            ))}
          </div>

          {bread.additions.length > 0 && (
            <div className="mt-4 border-t border-border pt-3.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                <span className="font-semibold text-muted-foreground">{t('site.additions_label')}</span>
                {bread.additions.map((a) => (
                  <span key={a} className="rounded-[4px] bg-card px-2.5 py-1 font-semibold leading-none">
                    {a}
                  </span>
                ))}
              </div>
              {surcharge > 0 && (
                <div className="mt-2 text-[12.5px] text-muted-foreground">
                  <span dir="ltr">+₪{surcharge}</span> {t('site.per_addition')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DealRow({ deal }: { deal: PublicDeal }) {
  // The offer in one line: how many, for how much, and what it saves. Olive
  // rather than the row's own colour — a deal is the same thing on every bread.
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[5px] bg-primary/[0.09] px-3 py-2 text-[13.5px]">
      <span className="font-semibold text-primary">{t('site.deal_label')}</span>
      <span className="font-semibold">
        <span className="tabular-nums">{deal.minQty}</span> {t('site.deal_for')}
        <span dir="ltr" className="tabular-nums"> ₪{deal.packPrice}</span>
      </span>
      <span className="ms-auto text-[12.5px] font-semibold text-primary">
        {/* The isolate goes on the digits — dir on the whole line would send
            the Hebrew word to the wrong end of it. */}
        {t('site.deal_save')} <span dir="ltr">₪{deal.saveAmount}</span>
      </span>
    </div>
  );
}
