import { t } from '@/lib/i18n';
import { getPublicSiteRequest, publicGroupId } from '@/lib/public-site';
import { buildBakeryJsonLd } from '@/lib/public-jsonld';
import { siteBaseUrl } from '@/lib/site-url';
import { SectionRenderer } from '@/components/public/SectionRenderer';
import { JsonLd } from '@/components/public/JsonLd';
import { TelegramRedirect } from '@/components/public/TelegramRedirect';

// ISR: cached render, refreshed at most hourly and purged on owner edits via
// revalidatePath('/'). The page reads the DB directly (no auth, no API).
export const revalidate = 3600;

export default async function PublicHome() {
  const site = await getPublicSiteRequest(publicGroupId());

  if (!site) {
    return (
      <main className="flex min-h-screen items-center justify-center px-8 text-center">
        {/* The same arch the real page opens with, so the site that is coming
            and the site that arrives are recognisably one place. */}
        <div className="site-arch flex w-full max-w-[280px] flex-col items-center justify-end gap-3 bg-foreground px-6 pb-9 pt-20 text-background">
          <span className="text-[42px] leading-none">🌾</span>
          <div className="site-display text-[26px]">{t('site.coming_soon')}</div>
          <div className="text-[14px] text-background/60">{t('site.coming_soon_sub')}</div>
        </div>
      </main>
    );
  }

  return (
    <>
      <JsonLd data={buildBakeryJsonLd(site, siteBaseUrl())} />
      <TelegramRedirect />
      <SectionRenderer site={site} />
    </>
  );
}
