import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { todayStr } from '@/lib/date-utils';
import { aggregateRecipesForOrders } from '@/lib/order-recipe';
import { getOrderDisplay, todayCondition, openUndated } from '@/lib/asap';

export const GET = withGroup(async (request, _auth, groupId) => {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const today = todayStr();
  const date = dateParam || today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('Invalid date format, expected YYYY-MM-DD', 400);
  }

  const isToday = date === today;
  const { asapInToday } = isToday ? await getOrderDisplay(groupId) : { asapInToday: false };

  const todayOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.groupId, groupId),
        todayCondition(date, isToday && asapInToday),
        ne(orders.status, 'cancelled')
      )
    );

  const { byType, unconfigured } = await aggregateRecipesForOrders(todayOrders.map((o) => o.id));

  // Switch off: today's בהקדם orders have no baking day, so they sit apart (no mixing weights).
  let asap: { name: string; loaves: number }[] = [];
  if (isToday && !asapInToday) {
    const undated = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.groupId, groupId), openUndated()));
    const agg = await aggregateRecipesForOrders(undated.map((o) => o.id));
    asap = agg.byType.map((t) => ({ name: t.name, loaves: t.totalLoaves }));
  }

  return jsonResponse({ date, today, byType, unconfigured, asap });
});
