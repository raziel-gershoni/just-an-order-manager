import Image from 'next/image';
import { t } from '@/lib/i18n';
import {
  type PublicSite,
  buildWhatsAppLink,
  buildTelegramLink,
} from '@/lib/public-site';
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
  const tgHref = buildTelegramLink(process.env.NEXT_PUBLIC_BOT_USERNAME);

  const hasDetails =
    !!(
      profile.bakeDays ||
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
        return <HeroSection key="hero" profile={profile} waHref={waHref} tgHref={tgHref} />;
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
      {/* Sticky top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-dashed border-border bg-background/85 px-[18px] py-2.5 backdrop-blur">
        <div className="flex items-center gap-2 font-display text-[15px] font-bold tracking-tight">
          {profile.logoUrl ? (
            <Image
              src={profile.logoUrl}
              alt={profile.displayName}
              width={26}
              height={26}
              className="h-[26px] w-[26px] rounded-full object-cover"
            />
          ) : (
            <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-primary text-[14px] text-primary-foreground shadow-[inset_0_0_0_2px_rgba(255,255,255,0.25)]">
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
            className="inline-flex items-center gap-1.5 rounded-full bg-success px-3 py-[7px] text-[12.5px] font-bold text-[#F1F4EA] shadow-[0_1px_0_rgba(0,0,0,0.15)]"
          >
            <WhatsAppIcon className="h-3.5 w-3.5" />
            {t('site.order_short')}
          </a>
        )}
      </header>

      <main className="mx-auto max-w-[480px] px-[18px] pb-12">
        {sections.filter((s) => s.visible).map((s) => render(s.key))}

        <footer className="mt-8 text-center text-[11.5px] leading-relaxed text-muted-foreground">
          <div className="font-mono text-[10.5px] tracking-wide">
            № 0042 · {profile.displayName}
          </div>
          {profile.pickupArea && <div className="mt-1.5 opacity-70">{profile.pickupArea}</div>}
        </footer>
      </main>
    </>
  );
}
