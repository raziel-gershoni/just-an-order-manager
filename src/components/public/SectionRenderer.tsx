import Image from 'next/image';
import { t } from '@/lib/i18n';
import { type PublicSite, buildWhatsAppLink } from '@/lib/public-site';
import { WhatsAppIcon } from './icons';
import { HeroSection } from './HeroSection';
import { GallerySection } from './GallerySection';
import { PricelistSection } from './PricelistSection';
import { StorySection } from './StorySection';
import { DetailsSection } from './DetailsSection';
import { CtaSection } from './CtaSection';

export function SectionRenderer({ site }: { site: PublicSite }) {
  const { profile, sections, catalog, gallery } = site;
  const waHref = buildWhatsAppLink(profile.whatsappPhone, t('site.wa_prefill'));

  const hasDetails =
    !!(
      profile.orderDays ||
      profile.pickupArea ||
      profile.whatsappPhone ||
      profile.contactPhone ||
      profile.instagram ||
      profile.address ||
      profile.delivery
    );

  const render = (key: string) => {
    switch (key) {
      case 'gallery':
        return gallery.length ? (
          <GallerySection key="gallery" images={gallery} name={profile.displayName} />
        ) : null;
      case 'pricelist':
        return catalog.length ? (
          <PricelistSection key="pricelist" catalog={catalog} additionsSurcharge={site.additionsSurcharge} />
        ) : null;
      case 'story':
        return profile.story?.trim() ? (
          <StorySection key="story" story={profile.story} signature={profile.displayName} />
        ) : null;
      case 'details':
        return hasDetails ? <DetailsSection key="details" profile={profile} waHref={waHref} /> : null;
      case 'cta':
        return waHref ? <CtaSection key="cta" waHref={waHref} /> : null;
      default:
        return null;
    }
  };

  const visible = sections.filter((s) => s.visible);
  const showHero = visible.some((s) => s.key === 'hero');

  return (
    <>
      {/* The oven: the bar and the hero share one unbroken dark ground, so the
          page begins inside it. The hero is pinned here rather than taking its
          turn in the owner's order — it is the opening by definition, and a
          dark band arriving in the middle of the counter would read as a
          mistake. Every other section keeps the order he set. */}
      <header className="sticky top-0 z-20 bg-foreground text-background">
        <div className="mx-auto flex max-w-[520px] items-center justify-between px-5 py-3.5">
          <div className="site-display flex items-center gap-2.5 text-[19px]">
            {profile.logoUrl ? (
              <Image
                src={profile.logoUrl}
                alt={profile.displayName}
                width={32}
                height={32}
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-[15px]">
                🌾
              </span>
            )}
            {profile.displayName}
          </div>
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-success px-4 py-2 text-[13px] font-bold text-success-foreground"
            >
              <WhatsAppIcon className="h-3.5 w-3.5" />
              {t('site.order_short')}
            </a>
          )}
        </div>
      </header>

      {showHero && (
        <div className="bg-foreground text-background">
          <div className="mx-auto max-w-[520px] px-5">
            <HeroSection profile={profile} waHref={waHref} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[520px] px-5 pb-14">
        {visible.filter((s) => s.key !== 'hero').map((s) => render(s.key))}

        <footer className="site-display mt-10 pt-6 text-center text-[14px] text-muted-foreground">
          {profile.displayName}
          {profile.pickupArea && ` · ${profile.pickupArea}`}
        </footer>
      </main>
    </>
  );
}
