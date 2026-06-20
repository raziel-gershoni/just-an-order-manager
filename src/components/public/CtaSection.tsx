import { t } from '@/lib/i18n';
import { WhatsAppButton } from './WhatsAppButton';

export function CtaSection({ waHref }: { waHref: string | null }) {
  return (
    <section className="relative mt-10 overflow-hidden rounded-xl bg-primary px-5 py-7 text-center text-primary-foreground">
      <span className="pointer-events-none absolute -bottom-8 left-[-6px] font-mono text-[120px] font-bold leading-none text-white/[0.06]">
        №
      </span>
      <h3 className="relative font-display text-[23px] font-bold tracking-tight">
        {t('site.cta_title')}
      </h3>
      <p className="relative mt-2 text-[14px] font-medium text-primary-foreground/80">
        {t('site.cta_sub')}
      </p>
      <div className="relative mt-4">
        <WhatsAppButton href={waHref} label={t('site.open_whatsapp')} variant="light" />
      </div>
    </section>
  );
}
