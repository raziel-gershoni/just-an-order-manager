import { t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function KitchenPairPage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  const { code, error } = await searchParams;
  return (
    <main className="notice">
      <h1 className="notice-title">{t('kitchen.pair_title')}</h1>
      {error || !code ? (
        <p className="notice-body">{t('kitchen.pair_expired')}</p>
      ) : (
        <>
          <p className="notice-body">{t('kitchen.pair_body')}</p>
          <form method="post" action="/api/kitchen/pair">
            <input type="hidden" name="code" value={code} />
            <button type="submit" className="pair-btn">{t('kitchen.pair_button')}</button>
          </form>
        </>
      )}
    </main>
  );
}
