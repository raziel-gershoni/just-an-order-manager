import { t } from '@/lib/i18n';
import { PairForm } from '@/components/kitchen/PairForm';

export const dynamic = 'force-dynamic';

export default async function KitchenPairPage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  const { code, error } = await searchParams;
  return (
    <main className="notice">
      <h1 className="notice-title">{t('kitchen.pair_title')}</h1>
      {!code || (error && error !== 'unavailable') ? (
        <p className="notice-body">{t('kitchen.pair_expired')}</p>
      ) : (
        <>
          {/* The code was not spent when the attempt failed, so the same button tries again. */}
          <p className="notice-body">{t(error ? 'kitchen.pair_unavailable' : 'kitchen.pair_body')}</p>
          <PairForm code={code} label={t('kitchen.pair_button')} />
        </>
      )}
    </main>
  );
}
