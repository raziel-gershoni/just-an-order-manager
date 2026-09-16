'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
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

type Lead = { deal: PublicDeal; size: PublicBread['sizes'][number] };

/**
 * The offer a row leads with: the deepest per-unit price anywhere on the bread.
 *
 * A bread can carry a pack on each of its sizes, and only one fits at the end
 * of a row, so the row advertises the best value on offer and the card lists
 * the rest. Ties go to the smaller pack — same price per loaf, less to carry
 * home. Null means this bread is sold by the loaf only, and the row falls back
 * to the single price.
 *
 * The size comes back with the pack because the row cannot honestly show one
 * without the other: a pack lives on ONE size, while the single price under it
 * is the range across all of them. Tiers are configured per size, so a 6-pack
 * on the large loaf sitting above "יחידה בודדת ₪25–45" invites the reader to
 * multiply the pack against the ₪25 — a different bread — and conclude the
 * pack is a swindle. Naming the size closes that gap.
 */
function leadDeal(bread: PublicBread): Lead | null {
  let best: Lead | null = null;
  for (const size of bread.sizes) {
    for (const deal of size.deals) {
      if (!best) {
        best = { deal, size };
        continue;
      }
      const each = Number(deal.eachPrice);
      const bestEach = Number(best.deal.eachPrice);
      if (each < bestEach || (each === bestEach && deal.minQty < best.deal.minQty)) {
        best = { deal, size };
      }
    }
  }
  return best;
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
          const lead = leadDeal(bread);
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
                  {/* The "מבצעים" tag used to sit here. The price itself now
                      says "6 יחידות ₪220", so the tag was the same news twice. */}
                </span>
                {bread.description && (
                  <span className="mt-1 block truncate text-[13px] leading-snug text-muted-foreground">
                    {bread.description}
                  </span>
                )}
              </span>

              {/* The pack leads and the loaf follows it, quietly: the bakery
                  sells by the pack, so the pack is the price of the bread and
                  the single is the alternative. Both lines align on the same
                  edge, so the column of prices still reads down the page. */}
              {lead ? (
                // Capped rather than free-running: a long size name wraps
                // inside this column instead of eating the bread's name.
                <span className="max-w-[55%] shrink-0 text-end">
                  <span className="block text-[19px] leading-tight">
                    <span className="text-[13px] font-semibold text-foreground">
                      {/* One size, no ambiguity — the name is only worth the
                          room when the bread is sold in more than one. */}
                      {bread.sizes.length > 1 && <>{lead.size.name} · </>}
                      <span className="tabular-nums">{lead.deal.minQty}</span> {t('site.units')}
                    </span>{' '}
                    <span className="site-display tabular-nums text-primary">
                      <span dir="ltr">₪{lead.deal.packPrice}</span>
                    </span>
                  </span>
                  {range && (
                    <span className="mt-1 block text-[12px] leading-tight text-muted-foreground">
                      {t('site.single_label')}{' '}
                      <span dir="ltr" className="tabular-nums">
                        {range}
                      </span>
                    </span>
                  )}
                </span>
              ) : (
                range && (
                  <span className="site-display shrink-0 text-[19px] tabular-nums text-primary">
                    <span dir="ltr">{range}</span>
                  </span>
                )
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

          <div className="mt-4">
            {bread.sizes.map((s, i) => (
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
 * bakery sells it — and each one carries what a loaf works out to inside it, so
 * the packs can be compared to each other and to the single line under them.
 * The single price is last and quiet: still there for anyone who wants one
 * loaf, no longer the headline. A size with no pack keeps the single price on
 * the name's own line, where it has always been, since there is nothing to
 * rank it against.
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
        <div key={d.minQty} className="mt-2.5">
          <div className="flex items-baseline gap-2">
            <span className={cn('font-semibold', j === 0 ? 'text-[15px]' : 'text-[14px]')}>
              <span className="tabular-nums">{d.minQty}</span> {t('site.units')}
            </span>
            {/* Every price in the block hangs off the same edge, so the packs
                and the loaf under them can be read as one column of numbers.
                The isolate goes on an inner span: margin-inline-start resolves
                against the element's OWN direction, so dir="ltr" out here would
                turn ms-auto into margin-left and drop the price mid-line. */}
            <span
              className={cn(
                'site-display ms-auto tabular-nums text-primary',
                j === 0 ? 'text-[22px]' : 'text-[18px]'
              )}
            >
              <span dir="ltr">₪{d.packPrice}</span>
            </span>
          </div>
          {/* What it works out to, and what it saves — the reason to take the
              pack, kept small and on one line rather than spread across the
              card. The isolates go on the digits: dir on the line would send
              the Hebrew words to the wrong end of it. */}
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            <span dir="ltr" className="tabular-nums">
              ₪{d.eachPrice}
            </span>{' '}
            {t('site.deal_each')} ·{' '}
            <span className="font-semibold text-primary">
              {t('site.deal_save')}{' '}
              <span dir="ltr" className="tabular-nums">
                ₪{d.saveAmount}
              </span>
            </span>
          </div>
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
