import { NextResponse } from 'next/server';
import { db } from '@/db';
import {
  groups,
  orders,
  customers,
  customerPhones,
  reminderTemplates,
  reminderSends,
} from '@/db/schema';
import { and, eq, ne, gte, lte, asc, desc } from 'drizzle-orm';
import { format, addDays } from 'date-fns';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';
import { pickNextTemplate } from '@/lib/reminders';
import { buildOrderItemsSummary } from '@/lib/order-summary';

export const maxDuration = 60;

/** yyyy-MM-dd `offset` days from now (server time). */
function dayStr(offset: number): string {
  return format(addDays(new Date(), offset), 'yyyy-MM-dd');
}

/**
 * The delivery-date window a given weekday's run reminds. Two runs a week:
 *   Sunday (0)    → deliveries Mon–Wed  (today+1 .. today+3)
 *   Wednesday (3) → deliveries Thu–Sun  (today+1 .. today+4)
 * Each run covers tomorrow through the day before the next run, so every
 * delivery day is reminded exactly once and no one is reminded the same
 * morning as delivery. Any other weekday is a no-op.
 *
 * QStash fires this at ~10:00 Asia/Jerusalem; at that hour the server-UTC date
 * equals the Jerusalem date, so `new Date()` is the correct "today" (same
 * convention as cron/morning-reminder).
 */
function runWindow(weekday: number): { start: string; end: string } | null {
  if (weekday === 0) return { start: dayStr(1), end: dayStr(3) };
  if (weekday === 3) return { start: dayStr(1), end: dayStr(4) };
  return null;
}

async function handler(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[cron/recurring-reminder] unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekday = new Date().getDay();
  const win = runWindow(weekday);
  if (!win) {
    return NextResponse.json({ ok: true, skipped: 'not a run day', weekday });
  }
  console.log(`[cron/recurring-reminder] window ${win.start}..${win.end}`);

  let allGroups: { id: number; enabled: boolean }[];
  try {
    allGroups = await db
      .select({ id: groups.id, enabled: groups.recurringRemindersEnabled })
      .from(groups);
  } catch (err) {
    console.error('[cron/recurring-reminder] failed to load groups:', err);
    // 200 so QStash doesn't retry-storm; the failure is in the logs.
    return NextResponse.json({ ok: false, error: 'load-groups-failed' });
  }

  const stats = { sent: 0, failed: 0, skippedOptOut: 0, skippedDup: 0, skippedNoPhone: 0 };
  const startOfToday = new Date(`${dayStr(0)}T00:00:00`);

  for (const group of allGroups) {
    if (!group.enabled) continue;
    try {
      // Active recurring templates for the group, in rotation order.
      const templates = await db
        .select()
        .from(reminderTemplates)
        .where(
          and(
            eq(reminderTemplates.groupId, group.id),
            eq(reminderTemplates.occasion, 'recurring'),
            eq(reminderTemplates.isActive, true)
          )
        )
        .orderBy(asc(reminderTemplates.sortOrder));
      if (templates.length === 0) continue; // owner hasn't configured a template

      // Active recurring orders due in this run's window, with their customer.
      const candidates = await db
        .select({
          orderId: orders.id,
          customerId: customers.id,
          optOut: customers.reminderOptOut,
        })
        .from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(
          and(
            eq(orders.groupId, group.id),
            eq(orders.isRecurring, true),
            ne(orders.status, 'delivered'),
            ne(orders.status, 'cancelled'),
            gte(orders.deliveryDate, win.start),
            lte(orders.deliveryDate, win.end)
          )
        );

      // One reminder per customer per run — a customer with two orders in the
      // same window is reminded once (the first). Cross-run/retry duplicates are
      // caught by the reminderSends check below.
      const seen = new Set<number>();

      for (const c of candidates) {
        if (seen.has(c.customerId)) continue;
        seen.add(c.customerId);

        if (c.optOut) {
          stats.skippedOptOut++;
          continue;
        }

        // Dedup: skip if this customer already got a recurring reminder today.
        // This serializes SEQUENTIAL re-deliveries (the realistic QStash retry).
        // Two genuinely-overlapping deliveries could both pass this check before
        // either inserts — accepted here: runs are tiny (a few recurring
        // customers) and finish in seconds, far under maxDuration, so QStash
        // never times out to trigger an overlapping redelivery in the first place.
        const [dup] = await db
          .select({ id: reminderSends.id })
          .from(reminderSends)
          .where(
            and(
              eq(reminderSends.customerId, c.customerId),
              eq(reminderSends.occasion, 'recurring'),
              gte(reminderSends.sentAt, startOfToday)
            )
          )
          .limit(1);
        if (dup) {
          stats.skippedDup++;
          continue;
        }

        // Notifiable phones (id + number) — respects the per-phone notify flag.
        const phones = await db
          .select({ id: customerPhones.id, phone: customerPhones.phone })
          .from(customerPhones)
          .where(and(eq(customerPhones.customerId, c.customerId), eq(customerPhones.notify, true)))
          .orderBy(asc(customerPhones.sortOrder));
        if (phones.length === 0) {
          stats.skippedNoPhone++;
          continue;
        }

        // Rotate the template per customer (usually just one recurring template).
        const [last] = await db
          .select({ templateId: reminderSends.templateId })
          .from(reminderSends)
          .where(and(eq(reminderSends.customerId, c.customerId), eq(reminderSends.occasion, 'recurring')))
          .orderBy(desc(reminderSends.sentAt))
          .limit(1);
        const template = pickNextTemplate(templates, last?.templateId ?? null);
        if (!template) continue;

        // {{1}} = this order's items, single comma-joined line (no newline).
        const summary = await buildOrderItemsSummary(c.orderId);
        if (!summary) {
          // A recurring order should always have items; guard so a malformed one
          // never sends a blank {{1}} (which Meta would reject anyway).
          console.warn(`[cron/recurring-reminder] order ${c.orderId} has no items — skipping`);
          continue;
        }

        for (const ph of phones) {
          const ok = await sendWhatsAppTemplate(ph.phone, template.metaTemplateName, 'he', [summary]);
          await db.insert(reminderSends).values({
            groupId: group.id,
            customerId: c.customerId,
            phoneId: ph.id,
            templateId: template.id,
            occasion: 'recurring',
            status: ok ? 'sent' : 'failed',
          });
          if (ok) stats.sent++;
          else stats.failed++;
        }
      }
    } catch (err) {
      console.error(`[cron/recurring-reminder] group ${group.id} failed:`, err);
    }
  }

  console.log('[cron/recurring-reminder] done:', stats);
  return NextResponse.json({ ok: true, window: win, ...stats });
}

export const GET = handler;
export const POST = handler;
