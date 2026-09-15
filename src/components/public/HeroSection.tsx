import Image from 'next/image';
import { t } from '@/lib/i18n';
import type { PublicProfile } from '@/lib/public-site';
import { WhatsAppButton } from './WhatsAppButton';

/**
 * The page opens inside the oven.
 *
 * Dark crust ground, and the loaf lit in the mouth of it — the arch is the
 * one shape this site is remembered by, so it carries the photo rather than
 * decorating something else. Everything under it comes out onto the counter.
 *
 * The ground is painted by the band this section sits in (SectionRenderer),
 * not here: the sticky bar has to be the same darkness with no seam between
 * them. When there is no photo yet the arch stays and holds the brand mark,
 * so the page has the same shape either way.
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
    <section className="pb-9">
      <div className="site-arch relative h-[330px] w-full overflow-hidden bg-card shadow-[0_40px_60px_-30px_rgba(0,0,0,0.9)] ring-1 ring-background/15">
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

      <div className="text-center">
        {eyebrow && (
          <div className="mt-6 text-[12.5px] font-semibold tracking-[0.12em] text-background/55">
            {eyebrow}
          </div>
        )}

        {headline ? (
          <h1 className="site-display mt-4 text-[40px] leading-[1.08] sm:text-[46px]">
            {headline}
          </h1>
        ) : (
          // One H1 either way: the brand name carries it when the owner leaves
          // the headline empty.
          <h1 className="sr-only">{profile.displayName}</h1>
        )}

        {lede && (
          <p className="mx-auto mt-3 max-w-[340px] text-[16px] leading-[1.6] text-background/70">
            {lede}
          </p>
        )}

        <div className="mt-6 flex">
          {/* WhatsApp is the only way in — the Telegram bot behind the old
              button is staff-side and answered customers with onboarding. */}
          <WhatsAppButton href={waHref} label={t('site.order_whatsapp')} className="flex-1" />
        </div>

        {profile.trustItems.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[13px] text-background/55">
            {profile.trustItems.map((item, i) => (
              <span key={i} className="inline-flex items-center gap-3">
                {i > 0 && <span className="text-primary">·</span>}
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
