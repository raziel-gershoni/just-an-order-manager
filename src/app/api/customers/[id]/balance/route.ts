import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { payments } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const GET = withGroup(async (request, _auth, groupId) => {
  const parts = new URL(request.url).pathname.split('/');
  const customerId = Number(parts[parts.indexOf('customers') + 1]);

  const [result] = await db
    .select({
      balance: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        eq(payments.groupId, groupId)
      )
    );

  return jsonResponse({ balance: result.balance });
});
