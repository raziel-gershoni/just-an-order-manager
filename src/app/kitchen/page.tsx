import { cookies } from 'next/headers';
import { KITCHEN_COOKIE, cacheEpoch, verifyScreenToken } from '@/lib/kitchen-screen';
import { getKitchenData, kitchenStamp } from '@/lib/kitchen-sheet';
import { KitchenScreen } from '@/components/kitchen/KitchenScreen';
import { KitchenNotice } from '@/components/kitchen/KitchenNotice';

export const dynamic = 'force-dynamic';

export default async function KitchenPage() {
  const token = (await cookies()).get(KITCHEN_COOKIE)?.value;
  const screen = token ? await verifyScreenToken(token) : null;
  if (!screen) {
    if (token) console.warn('[kitchen] screen cookie rejected on page load');
    return <KitchenNotice title={token ? 'kitchen.disconnected_title' : 'kitchen.not_connected_title'} />;
  }
  const data = await getKitchenData(screen.groupId);
  return <KitchenScreen data={data} stamp={kitchenStamp(data)} epoch={cacheEpoch()} renderedAt={new Date().toISOString()} />;
}
