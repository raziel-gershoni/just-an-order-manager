import Link from 'next/link';
import { t } from '@/lib/i18n';

// Hebrew/RTL DOCKET-styled 404 (the default Next page is English + unstyled).
// Inherits the root layout's noindex, so it never gets indexed.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-8 text-center">
      <div className="flex w-full max-w-[320px] flex-col items-center gap-4 rounded-[10px] border border-border bg-card px-6 py-10 shadow-sm">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-3xl">
          🍞
        </span>
        <div className="font-display text-3xl font-bold tracking-tight">404</div>
        <div className="font-display text-lg font-bold">{t('site.not_found')}</div>
        <div className="text-sm text-muted-foreground">{t('site.not_found_sub')}</div>
        <Link
          href="/"
          className="mt-1 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-[14px] font-bold text-primary-foreground"
        >
          {t('site.back_home')}
        </Link>
      </div>
    </main>
  );
}
