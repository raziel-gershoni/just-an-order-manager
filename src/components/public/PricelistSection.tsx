'use client';

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { PublicBread } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';
import { PublicBadge } from './PublicBadge';

// Accent hue for a bread: its badge color, else a quiet neutral (revisit later).
const NEUTRAL = '#A2937D';
function accentOf(bread: PublicBread): string {
  return bread.badge?.colorVar ?? NEUTRAL;
}
function rangeOf(bread: PublicBread): string | null {
  const sizes = bread.sizes; // sorted low → high
  if (sizes.length === 0) return null;
  const min = sizes[0].price;
  const max = sizes[sizes.length - 1].price;
  return min === max ? `₪${min}` : `₪${min} ${t('site.price_to')} ₪${max}`;
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

  // Close on Escape + lock background scroll while the note is open.
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
    <section className="mt-10">
      <PublicSectionHead label={t('site.pricelist')} meta={t('site.prices_note')} />
      {/* Flat connected docket — perforated row separators, no rounded corners. */}
      <div className="overflow-hidden border border-border bg-card shadow-[0_8px_22px_-18px_rgba(36,31,26,0.55)]">
        {catalog.map((bread, i) => {
          const accent = accentOf(bread);
          const range = rangeOf(bread);
          return (
            <button
              key={bread.id}
              type="button"
              onClick={() => setOpenId(bread.id)}
              className={cn(
                'flex w-full items-stretch text-start',
                i > 0 && 'border-t-[1.5px] border-dashed border-border'
              )}
            >
              {/* wide color stub + vertical dashed line between the color and the name */}
              <span
                aria-hidden
                className="w-6 shrink-0 self-stretch border-e-2 border-dashed border-card/60"
                style={{ background: accent }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2.5 px-3.5 py-3">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-display text-[16px] font-semibold">
                    <span className="truncate">{bread.name}</span>
                    {bread.badge && <PublicBadge badge={bread.badge} small />}
                  </span>
                  {range && (
                    <span className="whitespace-nowrap font-mono text-[13px] font-bold" style={{ color: accent }}>
                      {range}
                    </span>
                  )}
                  <ChevronStart />
                </span>
                {bread.description && (
                  <span className="block -mt-1 px-3.5 pb-3 text-[12.5px] leading-snug text-muted-foreground">
                    {bread.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {openBread && (
        <PricelistModal bread={openBread} surcharge={additionsSurcharge} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}

function PricelistModal({
  bread,
  surcharge,
  onClose,
}: {
  bread: PublicBread;
  surcharge: number;
  onClose: () => void;
}) {
  const accent = accentOf(bread);
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center p-7"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-[1px]" />
      {/* Tilted sticky note */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[330px] -rotate-[2.4deg] border p-4 shadow-[0_18px_40px_-14px_rgba(36,31,26,0.6)]"
        style={{
          background: `color-mix(in srgb, ${accent} 13%, var(--card))`,
          borderColor: `color-mix(in srgb, ${accent} 30%, var(--border))`,
        }}
      >
        {/* washi tape */}
        <span
          aria-hidden
          className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 -rotate-3 border border-white/30 shadow-sm"
          style={{ background: `color-mix(in srgb, ${accent} 22%, rgba(244,238,220,0.72))` }}
        />

        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-[18px] font-bold tracking-tight">{bread.name}</h3>
          {bread.badge && <PublicBadge badge={bread.badge} small />}
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="ms-auto grid h-7 w-7 place-items-center text-muted-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          {bread.sizes.map((s) => (
            <div
              key={s.id}
              className="flex items-stretch border bg-card"
              style={{ borderColor: `color-mix(in srgb, ${accent} 28%, var(--border))` }}
            >
              <span
                aria-hidden
                className="w-4 shrink-0 self-stretch border-e-[1.5px] border-dashed border-card/60"
                style={{ background: accent }}
              />
              <div className="flex flex-1 items-center justify-between gap-2 px-3 py-2 text-[14px]">
                <span className="flex items-center gap-1.5 font-semibold">
                  {s.name}
                  {s.badge && <PublicBadge badge={s.badge} small />}
                </span>
                <span className="font-mono font-bold tabular-nums">₪{s.price}</span>
              </div>
            </div>
          ))}
        </div>

        {bread.additions.length > 0 && (
          <div
            className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t-[1.5px] border-dashed pt-2.5 text-[12px]"
            style={{ borderColor: `color-mix(in srgb, ${accent} 35%, var(--border))` }}
          >
            <span className="font-semibold text-muted-foreground">{t('site.additions_label')}</span>
            {bread.additions.map((a) => (
              <span key={a} className="border border-border bg-card px-1.5 py-0.5 font-semibold">
                {a}
              </span>
            ))}
            {surcharge > 0 && (
              <span className="ms-auto whitespace-nowrap font-mono text-[11px] font-bold" style={{ color: accent }}>
                <span dir="ltr">+₪{surcharge}</span> {t('site.per_addition')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChevronStart() {
  // Points toward the inline-start (right in RTL) — a "tap to open" hint.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 text-muted-foreground/50">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
