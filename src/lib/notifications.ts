import { getBot } from './bot';
import { InlineKeyboard } from 'grammy';
import { db } from '@/db';
import { groupMembers, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { t } from './i18n';
import { sendWhatsAppTemplate } from './whatsapp';
import { daysAgoLabel, formatWeekdayShort } from './date-utils';

type Role = 'owner' | 'manager' | 'baker' | 'driver';

/**
 * Perforation rule under a header — the chat echo of the dashed docket dividers
 * in the app. Messages that carry it are the ones meant to break the run of
 * routine pings: an auto-renewal, a daily nudge.
 */
const RULE = '┄┄┄┄┄┄┄┄┄┄┄┄';

/** Button labels wrap badly past ~30 chars, so long customer names get clipped. */
function shortName(name: string, max = 18): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Escape text that goes into an HTML-parsed message body. Every send here uses
 * parse_mode: 'HTML', so a customer or bread type carrying an `&` or a `<` makes
 * Telegram reject the whole message. That was one lost ping before; the daily
 * nudges batch a dozen names into a single message, where one bad character
 * would take the entire backlog down with it. Button labels are plain text and
 * must NOT be escaped — they'd render the entities literally.
 */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Recipient {
  chatId: string;
  language: 'en' | 'he';
}

async function getRecipientsByRole(
  groupId: number,
  targetRoles: Role[]
): Promise<Recipient[]> {
  const members = await db
    .select({
      telegramId: users.telegramId,
      language: users.language,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  return members
    .filter((m) => targetRoles.includes(m.role) || m.role === 'owner')
    .map((m) => ({ chatId: m.telegramId, language: m.language }));
}

async function sendToRecipients(
  recipients: Recipient[],
  messageFn: (lang: 'en' | 'he') => string,
  replyMarkup?: InlineKeyboard
): Promise<{ sent: number; failed: number }> {
  const results = await Promise.allSettled(
    recipients.map((r) =>
      getBot().api.sendMessage(r.chatId, messageFn(r.language), {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      })
    )
  );
  let sent = 0;
  let failed = 0;
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
      // These were silently dropped before: a blocked bot, a stale chatId, a
      // 429 rate-limit, or a network error just vanished. Log so a missed
      // notification leaves a trace.
      console.error(
        `[notify] Telegram send failed to chatId ${recipients[i].chatId}:`,
        res.reason
      );
    }
  });
  return { sent, failed };
}

export async function notifyNewOrder(
  groupId: number,
  orderId: number,
  order: {
    customerName: string;
    items: { breadTypeName: string; quantity: number }[];
    deliveryDate: string | null;
    notes: string | null;
    /**
     * True when this order is the auto-created clone of a delivered recurring
     * order rather than one somebody just placed. Same body, different head:
     * its own emoji, title and perforation rule so a renewal reads as a renewal
     * at a glance instead of blending into the run of new-order pings.
     */
    isRenewal?: boolean;
  }
) {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  const keyboard = new InlineKeyboard()
    .text('אשר ✅', `order_status:${orderId}:confirmed`);

  await sendToRecipients(recipients, (lang) => {
    const lines = order.isRenewal
      ? [`<b>🔁 ${t('notify.recurring_renewed', lang)}</b>`, RULE]
      : [`<b>🍞 ${t('notify.new_order', lang)}</b>`, ``];
    lines.push(`<b>${t('notify.customer', lang)}:</b> ${esc(order.customerName)}`);
    for (const item of order.items) {
      lines.push(`  • ${item.quantity} ${esc(item.breadTypeName)}`);
    }
    if (order.deliveryDate) {
      lines.push(
        `<b>${t('notify.delivery_date', lang)}:</b> ${formatWeekdayShort(order.deliveryDate)}`
      );
    }
    if (order.notes) {
      lines.push(`<b>${t('notify.notes', lang)}:</b> ${esc(order.notes)}`);
    }
    return lines.join('\n');
  }, keyboard);
}

/**
 * Daily nudge: orders still waiting for someone to tap אשר. One message for the
 * whole backlog with one approve button per order, so the feed stays quiet
 * however many have piled up. `more` is the count that didn't fit.
 */
export async function notifyPendingApproval(
  groupId: number,
  pending: {
    id: number;
    customerName: string;
    deliveryDate: string | null;
    items: { breadTypeName: string; quantity: number }[];
  }[],
  more: number
): Promise<{ sent: number; failed: number }> {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  // .row() *between* buttons, never after the last — a trailing call leaves an
  // empty row in the markup Telegram has no use for.
  const keyboard = new InlineKeyboard();
  pending.forEach((o, i) => {
    if (i > 0) keyboard.row();
    keyboard.text(`${t('notify.approve')} · #${o.id} ${shortName(o.customerName)}`, `order_status:${o.id}:confirmed`);
  });

  return sendToRecipients(recipients, (lang) => {
    const title =
      pending.length === 1
        ? t('notify.pending_one', lang)
        : `${pending.length} ${t('notify.pending_many', lang)}`;
    const lines = [`<b>⏳ ${title}</b>`, RULE];
    for (const o of pending) {
      const when = o.deliveryDate ? formatWeekdayShort(o.deliveryDate) : t('delivery.asap', lang);
      lines.push(`<b>#${o.id} ${esc(o.customerName)}</b> — ${when}`);
      for (const item of o.items) {
        lines.push(`  • ${item.quantity} ${esc(item.breadTypeName)}`);
      }
    }
    if (more > 0) lines.push(``, `<i>${t('notify.and_more', lang)} ${more}</i>`);
    return lines.join('\n');
  }, keyboard);
}

/**
 * Daily nudge: orders delivered a while back that were never marked paid, each
 * with a one-tap שולם button. Managers, not bakers — this is a money list.
 */
export async function notifyUnpaidOrders(
  groupId: number,
  unpaid: { id: number; customerName: string; date: string; total: number }[],
  more: number
): Promise<{ sent: number; failed: number }> {
  const recipients = await getRecipientsByRole(groupId, ['manager']);
  const keyboard = new InlineKeyboard();
  unpaid.forEach((o, i) => {
    if (i > 0) keyboard.row();
    keyboard.text(
      `${t('notify.mark_paid')} · #${o.id} ${shortName(o.customerName)} ₪${o.total.toFixed(0)}`,
      `order_pay:${o.id}:paid`
    );
  });

  return sendToRecipients(recipients, (lang) => {
    const title =
      unpaid.length === 1
        ? t('notify.unpaid_one', lang)
        : `${unpaid.length} ${t('notify.unpaid_many', lang)}`;
    const lines = [`<b>💰 ${title}</b>`, RULE];
    for (const o of unpaid) {
      lines.push(
        `<b>#${o.id} ${esc(o.customerName)}</b> — ₪${o.total.toFixed(0)} · ${daysAgoLabel(o.date)}`
      );
    }
    if (more > 0) lines.push(``, `<i>${t('notify.and_more', lang)} ${more}</i>`);
    return lines.join('\n');
  }, keyboard);
}

export async function notifyOrderReady(
  groupId: number,
  orderId: number,
  order: {
    customerName: string;
    itemsSummary: string;
  }
) {
  const recipients = await getRecipientsByRole(groupId, ['manager']);
  const keyboard = new InlineKeyboard()
    .text('נמסר ✅', `order_status:${orderId}:delivered`);

  await sendToRecipients(recipients, (lang) =>
    [
      `<b>✅ ${t('notify.order_ready', lang)}</b>`,
      ``,
      `${esc(order.customerName)} — ${esc(order.itemsSummary)}`,
    ].join('\n'),
    keyboard
  );
}

/**
 * Send a WhatsApp template to all phones a customer has registered.
 * Each phone gets one independent send via Promise.allSettled — one failure
 * doesn't block the others.
 */
export async function notifyCustomerWhatsApp(
  customerPhones: string[] | null,
  templateName?: string,
  params?: string[]
) {
  if (!customerPhones || customerPhones.length === 0) return;
  const template = templateName || process.env.WHATSAPP_TEMPLATE_NAME || 'order_ready';
  await Promise.allSettled(
    customerPhones.map((p) => sendWhatsAppTemplate(p, template, 'he', params))
  );
}

export async function notifyPrepayment(
  groupId: number,
  data: { customerName: string; amount: string; balance: number }
) {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  await sendToRecipients(recipients, (lang) => {
    const lines = [
      `<b>💰 ${esc(data.customerName)} ${t('notify.prepayment', lang)} ₪${data.amount}</b>`,
    ];
    if (data.balance === 0) {
      lines.push(`✅ ${t('notify.settled', lang)}`);
    } else if (data.balance > 0) {
      lines.push(`${t('notify.credit_balance', lang)}: ₪${data.balance.toFixed(0)}`);
    } else {
      lines.push(`${t('notify.remaining_debt', lang)}: ₪${Math.abs(data.balance).toFixed(0)}`);
    }
    return lines.join('\n');
  });
}

export async function notifyBalanceAlert(
  groupId: number,
  data: { customerName: string; balance: string }
) {
  const recipients = await getRecipientsByRole(groupId, ['manager']);
  await sendToRecipients(recipients, (lang) =>
    `⚠️ ${esc(data.customerName)} ${t('notify.balance_alert', lang)} ₪${Math.abs(Number(data.balance))}`
  );
}

export async function notifyMemberJoined(
  groupId: number,
  data: { memberName: string; role: string }
) {
  const recipients = await getRecipientsByRole(groupId, ['owner']);
  await sendToRecipients(recipients, (lang) =>
    `👋 ${esc(data.memberName)} ${t('notify.member_joined', lang)} ${t(`role.${data.role}`, lang)}`
  );
}

export async function sendMorningSummary(
  groupId: number,
  orders: { customerName: string; breadTypeName: string; quantity: number }[],
  recipeBlock?: string
): Promise<{ sent: number; failed: number }> {
  if (orders.length === 0) return { sent: 0, failed: 0 };

  const recipients = await getRecipientsByRole(groupId, ['baker']);
  return await sendToRecipients(recipients, (lang) => {
    const lines = [`<b>📋 ${t('notify.morning_summary', lang)}</b>`, ''];

    // Group by bread type
    const byType: Record<string, { customers: string[]; total: number }> = {};
    for (const o of orders) {
      if (!byType[o.breadTypeName]) {
        byType[o.breadTypeName] = { customers: [], total: 0 };
      }
      byType[o.breadTypeName].customers.push(
        `${esc(o.customerName)} (${o.quantity})`
      );
      byType[o.breadTypeName].total += o.quantity;
    }

    for (const [type, data] of Object.entries(byType)) {
      lines.push(
        `<b>${esc(type)}</b> — ${data.total} ${t('notify.loaves', lang)}`
      );
      for (const c of data.customers) {
        lines.push(`  • ${c}`);
      }
      lines.push('');
    }

    const totalLoaves = orders.reduce((sum, o) => sum + o.quantity, 0);
    lines.push(
      `<b>${t('notify.total_today', lang)}:</b> ${totalLoaves} ${t('notify.loaves', lang)}`
    );

    if (recipeBlock) {
      lines.push('', recipeBlock);
    }

    return lines.join('\n');
  });
}
