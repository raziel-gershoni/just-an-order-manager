import { t } from '@/lib/i18n';
import { WhatsAppButton } from './WhatsAppButton';

/**
 * The last thing on the page: the crust, and one way in.
 *
 * Dark warm brown rather than the app's stamp violet — this band is the only
 * place the page goes dark, which is what makes it the end of the scroll. The
 * giant № watermark that used to sit behind it belonged to a filing system.
 */
export function CtaSection({ waHref }: { waHref: string | null }) {
  return (
    <section className="mt-12 rounded-[20px] bg-foreground px-6 py-9 text-center text-background">
      <h2 className="site-display text-[26px] font-bold leading-tight">{t('site.cta_title')}</h2>
      <p className="mx-auto mt-2 max-w-[300px] text-[14.5px] leading-relaxed text-background/75">
        {t('site.cta_sub')}
      </p>
      <div className="mt-5 flex">
        <WhatsAppButton href={waHref} label={t('site.open_whatsapp')} className="flex-1" />
      </div>
    </section>
  );
}
