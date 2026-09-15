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
      case 'hero':
        return <HeroSection key="hero" profile={profile} waHref={waHref} />;
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

  return (
    <>
      {/* Sticky bar — the brand, and the one action, always within thumb reach. */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
        <div className="site-display flex items-center gap-2.5 text-[17px] font-bold">
          {profile.logoUrl ? (
            <Image
              src={profile.logoUrl}
              alt={profile.displayName}
              width={30}
              height={30}
              className="h-[30px] w-[30px] rounded-full object-cover"
            />
          ) : (
            <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-card text-[15px]">
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
            className="inline-flex items-center gap-1.5 rounded-full bg-success px-3.5 py-2 text-[13px] font-bold text-success-foreground"
          >
            <WhatsAppIcon className="h-3.5 w-3.5" />
            {t('site.order_short')}
          </a>
        )}
      </header>

      <main className="mx-auto max-w-[520px] px-5 pb-16">
        {sections.filter((s) => s.visible).map((s) => render(s.key))}

        <footer className="mt-12 border-t border-border pt-6 text-center">
          <div className="site-display text-[15px] font-bold">{profile.displayName}</div>
          {profile.pickupArea && (
            <div className="mt-1 text-[12.5px] text-muted-foreground">{profile.pickupArea}</div>
          )}
        </footer>
      </main>
    </>
  );
}
