import { cookies } from 'next/headers';
import { KITCHEN_COOKIE, verifyScreenToken } from '@/lib/kitchen-screen';
import { getKitchenData, kitchenStamp } from '@/lib/kitchen-sheet';
import { KitchenSheets } from '@/components/kitchen/KitchenSheets';
import { KitchenLive } from '@/components/kitchen/KitchenLive';
import { t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function KitchenPage() {
  const token = (await cookies()).get(KITCHEN_COOKIE)?.value;
  const screen = token ? await verifyScreenToken(token) : null;
  if (!screen) {
    if (token) console.warn('[kitchen] screen cookie rejected on page load');
    return (
      <main className="notice">
        <h1 className="notice-title">{t(token ? 'kitchen.disconnected_title' : 'kitchen.not_connected_title')}</h1>
        <p className="notice-body">{t('kitchen.connect_steps')}</p>
      </main>
    );
  }
  const data = await getKitchenData(screen.groupId);
  return (
    <>
      <KitchenSheets data={data} />
      <KitchenLive stamp={kitchenStamp(data)} labels={{ updated: t('kitchen.updated_at'), offline: t('kitchen.offline') }} />
    </>
  );
}
