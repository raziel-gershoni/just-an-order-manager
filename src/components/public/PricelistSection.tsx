'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { PublicBread } from '@/lib/public-site';
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
 * The price a size leads with: its first pack if it sells in packs, else the
 * loaf. This is the number the card shows biggest for that size, and it is
 * what the sizes are ordered by — six buns at ₪40 sit below a loaf at ₪25,
 * because ₪40 is what the six-bun row asks for. A size whose price will not
 * parse sinks to the bottom rather than scrambling the order around it.
 */
function leadPrice(size: PublicBread['sizes'][number]): number {
  // deals ascend by quantity; the block leads with the last of them.
  const lead = size.deals.length ? size.deals[size.deals.length - 1].packPrice : size.price;
  const n = Number(lead);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
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
function Tile({ bread, dim }: { bread: PublicBread; dim?: boolean }) {
  // The fade belongs on the tile itself. It used to sit on a `display: contents`
  // wrapper around it, where it did nothing at all: an element with
  // `display: contents` generates no box, and with no box there is nothing for
  // opacity to apply to — the photo rendered pixel-identical to an in-stock one.
  const box = cn('h-[78px] w-[58px] shrink-0 rounded-[3px]', dim && 'opacity-45');
  // Portrait, not square: a standing challah or a long כפרי keeps its shape
  // instead of having both ends cropped away.
  if (bread.image) {
    return (
      <span className={cn('relative overflow-hidden bg-card', box)}>
        <Image src={bread.image.url} alt="" fill sizes="58px" className="object-cover" />
      </span>
    );
  }
  // No photo yet: flour dust on a board. It holds the column so the names
  // still line up, and does not pretend to be a picture.
  return <span aria-hidden className={cn('site-notile', box)} />;
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
                i > 0 && 'border-t border-border'
              )}
            >
              {/* Sold out dims the picture and greys the name. Fading the whole
                  row — which is what this did — took the price to 2:1 against
                  the counter: unreadable, when the point is to say what it will
                  cost when it is back. The badge already names the state. */}
              <Tile bread={bread} dim={soldOut} />

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      'site-display truncate text-[20px] leading-tight',
                      soldOut && 'text-muted-foreground'
                    )}
                  >
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
  // aria-modal tells a screen reader to ignore everything behind this card, so
  // focus has to come inside it or a keyboard user is left tabbing through rows
  // that are no longer announced — and cannot scroll the card at all.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

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
        {/* Close sits in the corner rather than in the title row: with the photo
            beside the name there is no room left on that line, and top-inline-end
            is where a hand reaches for it. Sticky inside a zero-height box, so
            it stays in that corner on a bread long enough to scroll — absolute
            would pin it to the top of the CONTENT and scroll it away. */}
        <div className="sticky top-0 z-10 h-0">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('site.close')}
          className="absolute end-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-background/85 text-muted-foreground transition-colors hover:bg-card"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        </div>

        <div className="px-5 pt-5">
          {/* Portrait here too, and inset rather than bleeding across the top:
              a 3:4 photo at full card width would be taller than the phone and
              push every price below the fold — and the prices are what the tap
              was for. Beside the name it stays the same shape as the row that
              opened it, just bigger. */}
          <div className="flex items-start gap-4">
            {bread.image && (
              <div className="relative aspect-[4/5] w-[34%] max-w-[132px] shrink-0 overflow-hidden rounded-[5px] bg-card">
                <Image
                  src={bread.image.url}
                  alt={bread.image.alt?.trim() || bread.name}
                  fill
                  sizes="132px"
                  className="object-cover"
                />
              </div>
            )}
            <div className="min-w-0 flex-1 pe-8">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="site-display text-[26px] leading-tight">{bread.name}</h3>
                {bread.badge && <PublicBadge badge={bread.badge} />}
              </div>
              {bread.description && (
                <p className="mt-2 text-[14.5px] leading-[1.6] text-muted-foreground">
                  {bread.description}
                </p>
              )}
            </div>
          </div>

          {/* Ordered by the price each size leads with, not by the loaf: a size
              sold in packs is asking for the pack price, so that is what it
              takes its place in the list by. (The pricelist row outside still
              ranges over the loaf prices — the server sorts for that.) */}
          <div className="mt-4">
            {[...bread.sizes]
              .sort((a, b) => leadPrice(a) - leadPrice(b))
              .map((s, i) => (
                <SizeBlock key={s.id} size={s} first={i === 0} />
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

/**
 * One size, priced by the pack.
 *
 * The packs come first, biggest first — that is the price of this bread as the
 * bakery sells it — each on one line with what it saves. The single price is
 * last and quiet: still there for anyone who wants one loaf, no longer the
 * headline. A size with no pack keeps the single price on the name's own line,
 * where it has always been, since there is nothing to rank it against.
 */
function SizeBlock({
  size,
  first,
}: {
  size: PublicBread['sizes'][number];
  first: boolean;
}) {
  const packs = [...size.deals].reverse(); // deriveDeals ascends by quantity
  return (
    <div className={cn('py-3', !first && 'border-t border-border')}>
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold">{size.name}</span>
        {size.badge && <PublicBadge badge={size.badge} small />}
        {size.weightGrams != null && (
          <span dir="ltr" className="text-[12.5px] tabular-nums text-muted-foreground">
            {size.weightGrams}g
          </span>
        )}
        {packs.length === 0 && (
          // The isolate goes on an inner span: margin-inline-start resolves
          // against the element's OWN direction, so dir="ltr" here would turn
          // ms-auto into margin-left and the price would sit against the weight
          // instead of the far edge.
          <span className="site-display ms-auto text-[19px] tabular-nums text-primary">
            <span dir="ltr">₪{size.price}</span>
          </span>
        )}
      </div>

      {packs.map((d, j) => (
        <div key={d.minQty} className="mt-2.5 flex items-baseline gap-2">
          <span className={cn('font-semibold', j === 0 ? 'text-[15px]' : 'text-[14px]')}>
            <span className="tabular-nums">{d.minQty}</span> {t('site.units')}
          </span>
          {/* The saving belongs to this offer, so it rides on the offer's own
              line. Under it, it read as a loose remark about the size. The
              isolate goes on the digits — dir on the phrase would send the
              Hebrew word to the wrong end of it. */}
          <span className="text-[12.5px] font-semibold text-primary">
            · {t('site.deal_save')}{' '}
            <span dir="ltr" className="tabular-nums">
              ₪{d.saveAmount}
            </span>
          </span>
          {/* Every price in the block hangs off the same edge, so the packs and
              the loaf under them read as one column of numbers. The isolate
              goes on an inner span: margin-inline-start resolves against the
              element's OWN direction, so dir="ltr" out here would turn ms-auto
              into margin-left and drop the price mid-line. */}
          <span
            className={cn(
              'site-display ms-auto tabular-nums text-primary',
              j === 0 ? 'text-[21px]' : 'text-[17px]'
            )}
          >
            <span dir="ltr">₪{d.packPrice}</span>
          </span>
        </div>
      ))}

      {packs.length > 0 && (
        <div className="mt-2.5 flex items-baseline gap-2 text-muted-foreground">
          <span className="text-[13.5px]">{t('site.single_label')}</span>
          <span className="ms-auto text-[15px]">
            <span dir="ltr" className="tabular-nums">
              ₪{size.price}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
