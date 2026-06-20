import { t } from '@/lib/i18n';
import type { PublicBread } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';
import { PublicBadge } from './PublicBadge';

export function PricelistSection({ catalog }: { catalog: PublicBread[] }) {
  return (
    <section className="mt-10">
      <PublicSectionHead label={t('site.pricelist')} meta={t('site.prices_note')} />

      <div className="relative overflow-hidden rounded-[10px] border border-border bg-card shadow-[0_8px_22px_-18px_rgba(36,31,26,0.55)]">
        {catalog.map((bread, i) => (
          <div
            key={bread.id}
            className={`flex items-start gap-3 px-4 py-4 ${
              i > 0 ? 'border-t-[1.5px] border-dashed border-border' : ''
            }`}
          >
            {bread.image ? (
              <div className="h-[58px] w-[58px] flex-none overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bread.image.url}
                  alt={bread.image.alt ?? bread.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            ) : (
              <span className="min-w-[22px] pt-1 font-mono text-[11px] font-bold text-muted-foreground">
                {String(i + 1).padStart(2, '0')}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-display text-[16.5px] font-semibold tracking-tight">
                {bread.name}
                {bread.badge && <PublicBadge badge={bread.badge} />}
              </div>
              {bread.description && (
                <div className="mt-[3px] text-[12.5px] leading-snug text-muted-foreground">
                  {bread.description}
                </div>
              )}
              {bread.sizes.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-[7px]">
                  {bread.sizes.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-secondary px-2 py-[3px] font-mono text-[11.5px] font-semibold"
                    >
                      {s.name} · <b className="font-bold text-primary">₪{s.price}</b>
                      {s.badge && <PublicBadge badge={s.badge} small />}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
