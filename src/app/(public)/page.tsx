import { t } from '@/lib/i18n';
import { getPublicSiteRequest, publicGroupId } from '@/lib/public-site';
import { SectionRenderer } from '@/components/public/SectionRenderer';
import { TelegramRedirect } from '@/components/public/TelegramRedirect';

// ISR: cached render, refreshed at most hourly and purged on owner edits via
// revalidatePath('/'). The page reads the DB directly (no auth, no API).
export const revalidate = 3600;

export default async function PublicHome() {
  const site = await getPublicSiteRequest(publicGroupId());

  if (!site) {
    return (
      <main className="flex min-h-screen items-center justify-center px-8 text-center">
        <div className="flex w-full max-w-[300px] flex-col items-center gap-4 rounded-[10px] border border-border bg-card px-6 py-8 shadow-sm">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-3xl">
            🌾
          </span>
          <div className="font-display text-xl font-bold">{t('site.coming_soon')}</div>
          <div className="text-sm text-muted-foreground">{t('site.coming_soon_sub')}</div>
        </div>
      </main>
    );
  }

  return (
    <>
      <TelegramRedirect />
      <SectionRenderer site={site} />
    </>
  );
}
