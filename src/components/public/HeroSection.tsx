import { t } from '@/lib/i18n';
import type { PublicProfile } from '@/lib/public-site';
import { WhatsAppButton } from './WhatsAppButton';

export function HeroSection({
  profile,
  waHref,
  tgHref,
}: {
  profile: PublicProfile;
  waHref: string | null;
  tgHref: string | null;
}) {
  const headline = profile.heroHeadline?.trim() || '';
  const eyebrow = profile.eyebrow?.trim() || '';
  const lede = profile.tagline;
  const hero = profile.heroImage;

  return (
    <section className="pt-8 pb-4 text-center">
      {!hero &&
        (profile.logoUrl ? (
          <div className="mx-auto mb-5 h-[88px] w-[88px] overflow-hidden rounded-full border-2 border-primary bg-card shadow-[0_4px_16px_-10px_rgba(36,31,26,0.6)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={profile.logoUrl} alt={profile.displayName} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="relative mx-auto mb-5 grid h-[88px] w-[88px] -rotate-[4deg] place-items-center rounded-full border-2 border-primary bg-card shadow-[0_4px_16px_-10px_rgba(36,31,26,0.6)]">
            <span className="absolute inset-1.5 rounded-full border border-dashed border-primary/50" />
            <span className="text-[34px] leading-none">🌾</span>
          </div>
        ))}

      {eyebrow && (
        <div className="flex items-center justify-center gap-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          <span className="h-px w-6 bg-border" />
          {eyebrow}
          <span className="h-px w-6 bg-border" />
        </div>
      )}

      {headline ? (
        <h1 className="mt-4 font-display text-[34px] font-bold leading-[1.04] tracking-tight sm:text-[40px]">
          {headline}
        </h1>
      ) : (
        // Guarantee exactly one H1 for SEO/a11y even when the owner leaves the
        // hero headline blank — fall back to the brand name, visually hidden.
        <h1 className="sr-only">{profile.displayName}</h1>
      )}

      {lede && (
        <p className="mx-auto mt-3 max-w-[330px] text-[15.5px] font-medium leading-relaxed text-muted-foreground">
          {lede}
        </p>
      )}

      {hero && (
        <div className="relative mx-auto mt-6 h-[210px] w-full overflow-hidden rounded-[10px] border border-border shadow-[0_10px_26px_-16px_rgba(36,31,26,0.5)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hero.url}
            alt={hero.alt ?? headline}
            className="h-full w-full object-cover"
            loading="eager"
          />
        </div>
      )}

      <div className="mt-5 flex gap-2.5">
        <WhatsAppButton href={waHref} label={t('site.order_whatsapp')} className="flex-1" />
        {tgHref && (
          <a
            href={tgHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center rounded-lg border-[1.5px] border-border px-4 py-3.5 text-[15px] font-bold text-foreground"
          >
            {t('site.order_telegram')}
          </a>
        )}
      </div>

      {profile.trustItems.length > 0 && (
        <div className="mt-[18px] flex flex-wrap justify-center gap-x-3.5 gap-y-2 text-[12px] font-semibold text-muted-foreground">
          {profile.trustItems.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-2">
              {i > 0 && <span className="-ms-2 inline-block h-[3px] w-[3px] rounded-full bg-warning" />}
              {item}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
