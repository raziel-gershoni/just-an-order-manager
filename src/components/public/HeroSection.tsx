import Image from 'next/image';
import { t } from '@/lib/i18n';
import type { PublicProfile } from '@/lib/public-site';
import { WhatsAppButton } from './WhatsAppButton';

/**
 * The first screen, and the page's whole argument: a loaf, shaped like the
 * mouth of the oven it came out of.
 *
 * The photo leads. It used to come fourth — after a medallion, an eyebrow
 * between two hairlines, and a headline — which is a lot of paperwork to get
 * through before anyone saw bread. When there is no photo yet the arch stays
 * and holds the brand mark, so the page has the same shape either way.
 */
export function HeroSection({
  profile,
  waHref,
}: {
  profile: PublicProfile;
  waHref: string | null;
}) {
  const headline = profile.heroHeadline?.trim() || '';
  const eyebrow = profile.eyebrow?.trim() || '';
  const lede = profile.tagline;
  const hero = profile.heroImage;

  return (
    <section className="pb-2 pt-5">
      <div className="site-arch relative h-[320px] w-full overflow-hidden bg-card shadow-[0_18px_40px_-28px_rgba(43,28,17,0.55)]">
        {hero ? (
          <Image
            src={hero.url}
            alt={hero.alt || headline || profile.displayName}
            fill
            sizes="(max-width: 520px) 100vw, 520px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            {profile.logoUrl ? (
              <Image
                src={profile.logoUrl}
                alt={profile.displayName}
                width={96}
                height={96}
                className="h-24 w-24 rounded-full object-cover"
              />
            ) : (
              <span className="text-[56px] leading-none opacity-70">🌾</span>
            )}
          </div>
        )}
      </div>

      <div className="pt-6 text-center">
        {eyebrow && (
          <div className="text-[12px] font-semibold tracking-[0.14em] text-primary">
            {eyebrow}
          </div>
        )}

        {headline ? (
          <h1 className="site-display mt-2 text-[38px] font-bold leading-[1.1] sm:text-[44px]">
            {headline}
          </h1>
        ) : (
          // One H1 either way: the brand name carries it when the owner leaves
          // the headline empty.
          <h1 className="sr-only">{profile.displayName}</h1>
        )}

        {lede && (
          <p className="mx-auto mt-3 max-w-[340px] text-[16px] leading-[1.6] text-muted-foreground">
            {lede}
          </p>
        )}

        <div className="mt-6 flex">
          {/* WhatsApp is the only way in — the Telegram bot behind the old
              button is staff-side and answered customers with onboarding. */}
          <WhatsAppButton href={waHref} label={t('site.order_whatsapp')} className="flex-1" />
        </div>

        {profile.trustItems.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted-foreground">
            {profile.trustItems.map((item, i) => (
              <span key={i} className="inline-flex items-center gap-2.5">
                {i > 0 && <span className="h-1 w-1 rounded-full bg-primary/50" />}
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
