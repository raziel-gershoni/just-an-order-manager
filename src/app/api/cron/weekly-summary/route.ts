import { NextResponse } from 'next/server';
import { db } from '@/db';
import {
  groups,
  orders,
  payments,
  customers,
  groupMembers,
  users,
} from '@/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { format, subDays } from 'date-fns';
import { getBot } from '@/lib/bot';
import { t } from '@/lib/i18n';

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[cron/weekly-summary] unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = format(new Date(), 'yyyy-MM-dd');
  const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
  console.log(`[cron/weekly-summary] starting for ${weekAgo}..${today}`);

  let allGroups: { id: number }[];
  try {
    allGroups = await db.select({ id: groups.id }).from(groups);
  } catch (err) {
    console.error('[cron/weekly-summary] failed to load groups:', err);
    return NextResponse.json({ ok: false, error: 'load-groups-failed' });
  }

  const stats = { total: allGroups.length, sent: 0, failed: 0 };

  for (const group of allGroups) {
    try {
      const [deliveredResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(orders)
        .where(
          and(
            eq(orders.groupId, group.id),
            eq(orders.status, 'delivered'),
            gte(orders.updatedAt, new Date(weekAgo)),
            lte(orders.updatedAt, new Date(today + 'T23:59:59'))
          )
        );

      const [revenueResult] = await db
        .select({
          total: sql<string>`COALESCE(SUM(ABS(${payments.amount})), 0)`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.groupId, group.id),
            eq(payments.type, 'charge'),
            gte(payments.createdAt, new Date(weekAgo))
          )
        );

      const debtors = await db
        .select({
          customerName: customers.name,
          balance: sql<string>`SUM(${payments.amount})`,
        })
        .from(payments)
        .innerJoin(customers, eq(payments.customerId, customers.id))
        .where(eq(payments.groupId, group.id))
        .groupBy(customers.name)
        .having(sql`SUM(${payments.amount}) < 0`);

      const members = await db
        .select({
          telegramId: users.telegramId,
          language: users.language,
        })
        .from(groupMembers)
        .innerJoin(users, eq(groupMembers.userId, users.id))
        .where(eq(groupMembers.groupId, group.id));

      for (const member of members) {
        const lang = member.language as 'en' | 'he';
        const lines = [
          `<b>📊 ${t('notify.weekly_summary', lang)}</b>`,
          '',
          `<b>${t('general.orders_fulfilled', lang)}:</b> ${deliveredResult.count}`,
          `<b>${t('general.revenue', lang)}:</b> ₪${Number(revenueResult.total).toFixed(0)}`,
        ];

        if (debtors.length > 0) {
          lines.push('');
          lines.push(`<b>${t('general.outstanding', lang)}:</b>`);
          for (const d of debtors) {
            lines.push(
              `  • ${d.customerName}: ₪${Math.abs(Number(d.balance)).toFixed(0)}`
            );
          }
        }

        try {
          await getBot().api.sendMessage(member.telegramId, lines.join('\n'), {
            parse_mode: 'HTML',
          });
        } catch (err) {
          console.warn(
            `[cron/weekly-summary] sendMessage to ${member.telegramId} failed:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      stats.sent++;
    } catch (err) {
      stats.failed++;
      console.error(`[cron/weekly-summary] group ${group.id} failed:`, err);
    }
  }

  console.log('[cron/weekly-summary] done:', stats);
  return NextResponse.json({ ok: true, ...stats });
}
