import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { format } from 'date-fns';
import { aggregateRecipesForOrders } from '@/lib/order-recipe';

export const GET = withGroup(async (request, _auth, groupId) => {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const date = dateParam || format(new Date(), 'yyyy-MM-dd');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('Invalid date format, expected YYYY-MM-DD', 400);
  }

  const todayOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.groupId, groupId),
        eq(orders.deliveryDate, date),
        ne(orders.status, 'cancelled')
      )
    );

  const { byType, unconfigured } = await aggregateRecipesForOrders(todayOrders.map((o) => o.id));
  return jsonResponse({ date, byType, unconfigured });
});
