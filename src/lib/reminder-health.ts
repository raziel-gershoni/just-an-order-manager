import { db } from '@/db';
import { orders, customers, groups, reminderSends } from '@/db/schema';
import { and, eq, ne, gte, lte, asc, sql } from 'drizzle-orm';
import { format, subDays } from 'date-fns';

/**
 * Is the automatic recurring reminder actually running?
 *
 * It shipped switched on, with its template registered and an eligible
 * customer, and sent nothing for three weeks — the QStash schedule behind it
 * was never created. Every check the feature makes is a reason to stay quiet,
 * so a cron that never fires looks exactly like a cron with nothing to do.
 * This is the one check that reads the silence itself.
 *
 * The signal: a recurring order rolled past its delivery date while nothing at
 * all was reminded. That can only mean the run never happened — a customer who
 * opted out, or a delivery outside every window, would still leave the rest of
 * the schedule sending.
 */

/** How far back a delivery counts as "should already have been reminded". */
const MISSED_WINDOW_DAYS = 7;

/**
 * How far back a single successful send proves the cron is alive. Wider than
 * the missed window on purpose: a delivery six days ago was reminded two or
 * three days before that, so a narrower window would call a healthy schedule
 * dead.
 */
const ALIVE_WINDOW_DAYS = 14;

export interface MissedReminder {
  orderId: number;
  customerName: string;
  deliveryDate: string;
}

export interface ReminderHealth {
  /** Recurring deliveries that passed unreminded, newest first. Empty is normal. */
  missed: MissedReminder[];
  /**
   * Why nothing landed. 'delivery' when the cron ran and every send failed —
   * an expired WhatsApp token, a paused template, a customer who blocked the
   * number; 'schedule' when there were no attempts at all. The warning used to
   * blame the schedule either way, which sent the owner to re-check three
   * healthy QStash entries every morning.
   */
  cause: 'schedule' | 'delivery';
}

/**
 * Recurring deliveries that passed unreminded — empty whenever the feature is
 * off, nothing was due, or the cron has actually delivered something recently.
 * A non-empty answer means the reminders need looking at, and `cause` says
 * where to look.
 */
export async function findMissedRecurringReminders(
  groupId: number
): Promise<ReminderHealth> {
  const [group] = await db
    .select({ enabled: groups.recurringRemindersEnabled })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group?.enabled) return { missed: [], cause: 'schedule' };

  // status='sent', not merely a row. The cron writes a row for every attempt,
  // failures included — so when the WhatsApp token expired, every send failed,
  // the rows kept appearing, and this probe reported the schedule alive for the
  // whole outage it exists to catch. A run where nothing lands is exactly the
  // silence the owner needs told about.
  const [counts] = await db
    .select({
      attempts: sql<number>`COUNT(*)`,
      landed: sql<number>`COUNT(*) FILTER (WHERE ${reminderSends.status} = 'sent')`,
    })
    .from(reminderSends)
    .where(
      and(
        eq(reminderSends.groupId, groupId),
        eq(reminderSends.occasion, 'recurring'),
        gte(reminderSends.sentAt, subDays(new Date(), ALIVE_WINDOW_DAYS))
      )
    );
  if (Number(counts?.landed ?? 0) > 0) return { missed: [], cause: 'schedule' };
  const cause: 'schedule' | 'delivery' =
    Number(counts?.attempts ?? 0) > 0 ? 'delivery' : 'schedule';

  const missed = await db
    .select({
      orderId: orders.id,
      customerName: customers.name,
      deliveryDate: orders.deliveryDate,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        eq(orders.isRecurring, true),
        ne(orders.status, 'cancelled'),
        // Already past — a delivery still ahead of us may yet be reminded.
        gte(orders.deliveryDate, format(subDays(new Date(), MISSED_WINDOW_DAYS), 'yyyy-MM-dd')),
        lte(orders.deliveryDate, format(subDays(new Date(), 1), 'yyyy-MM-dd')),
        // An opted-out customer is skipped by design, not by failure.
        eq(customers.reminderOptOut, false)
      )
    )
    .orderBy(sql`${orders.deliveryDate} desc`, asc(orders.id))
    .then((rows) =>
      rows
        .filter((r): r is typeof r & { deliveryDate: string } => r.deliveryDate != null)
        .map((r) => ({
          orderId: r.orderId,
          customerName: r.customerName,
          deliveryDate: r.deliveryDate,
        }))
    );

  return { missed, cause };
}
