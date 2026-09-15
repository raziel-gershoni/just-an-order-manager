import { t } from '@/lib/i18n';
import { WhatsAppButton } from './WhatsAppButton';

/**
 * The last thing on the page: the crust, and one way in.
 *
 * The same crust the page opened with, closing it: you come out of the oven at
 * the top, walk the counter, and end back at the door. The giant № watermark
 * that used to sit behind this belonged to a filing system.
 */
export function CtaSection({ waHref }: { waHref: string | null }) {
  return (
    <section className="mt-12 rounded-[14px] bg-foreground px-6 py-10 text-center text-background">
      <h2 className="site-display text-[28px] leading-tight">{t('site.cta_title')}</h2>
      <p className="mx-auto mt-2 max-w-[300px] text-[14.5px] leading-relaxed text-background/65">
        {t('site.cta_sub')}
      </p>
      <div className="mt-5 flex">
        <WhatsAppButton href={waHref} label={t('site.open_whatsapp')} className="flex-1" />
      </div>
    </section>
  );
}
