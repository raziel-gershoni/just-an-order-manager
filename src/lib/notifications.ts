import { getBot } from './bot';
import { InlineKeyboard } from 'grammy';
import { db } from '@/db';
import { groupMembers, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { t } from './i18n';
import { sendWhatsAppTemplate } from './whatsapp';

type Role = 'owner' | 'manager' | 'baker';

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
) {
  const results = await Promise.allSettled(
    recipients.map((r) =>
      getBot().api.sendMessage(r.chatId, messageFn(r.language), {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      })
    )
  );
  return results;
}

export async function notifyNewOrder(
  groupId: number,
  orderId: number,
  order: {
    customerName: string;
    items: { breadTypeName: string; quantity: number }[];
    deliveryDate: string | null;
    notes: string | null;
  }
) {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  const keyboard = new InlineKeyboard()
    .text('אשר ✅', `order_status:${orderId}:confirmed`);

  await sendToRecipients(recipients, (lang) => {
    const lines = [
      `<b>🍞 ${t('notify.new_order', lang)}</b>`,
      ``,
      `<b>${t('notify.customer', lang)}:</b> ${order.customerName}`,
    ];
    for (const item of order.items) {
      lines.push(`  • ${item.quantity} ${item.breadTypeName}`);
    }
    if (order.deliveryDate) {
      lines.push(
        `<b>${t('notify.delivery_date', lang)}:</b> ${order.deliveryDate}`
      );
    }
    if (order.notes) {
      lines.push(`<b>${t('notify.notes', lang)}:</b> ${order.notes}`);
    }
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
      `${order.customerName} — ${order.itemsSummary}`,
    ].join('\n'),
    keyboard
  );
}

export async function notifyCustomerWhatsApp(
  customerPhone: string | null,
  templateName?: string,
  params?: string[]
) {
  if (!customerPhone) return;
  const template = templateName || process.env.WHATSAPP_TEMPLATE_NAME || 'order_ready';
  await sendWhatsAppTemplate(customerPhone, template, 'he', params);
}

export async function notifyPrepayment(
  groupId: number,
  data: { customerName: string; amount: string; balance: number }
) {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  await sendToRecipients(recipients, (lang) => {
    const lines = [
      `<b>💰 ${data.customerName} ${t('notify.prepayment', lang)} ₪${data.amount}</b>`,
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
    `⚠️ ${data.customerName} ${t('notify.balance_alert', lang)} ₪${Math.abs(Number(data.balance))}`
  );
}

export async function notifyMemberJoined(
  groupId: number,
  data: { memberName: string; role: string }
) {
  const recipients = await getRecipientsByRole(groupId, ['owner']);
  await sendToRecipients(recipients, (lang) =>
    `👋 ${data.memberName} ${t('notify.member_joined', lang)} ${t(`role.${data.role}`, lang)}`
  );
}

export async function sendMorningSummary(
  groupId: number,
  orders: { customerName: string; breadTypeName: string; quantity: number }[]
) {
  if (orders.length === 0) return;

  const recipients = await getRecipientsByRole(groupId, ['baker']);
  await sendToRecipients(recipients, (lang) => {
    const lines = [`<b>📋 ${t('notify.morning_summary', lang)}</b>`, ''];

    // Group by bread type
    const byType: Record<string, { customers: string[]; total: number }> = {};
    for (const o of orders) {
      if (!byType[o.breadTypeName]) {
        byType[o.breadTypeName] = { customers: [], total: 0 };
      }
      byType[o.breadTypeName].customers.push(
        `${o.customerName} (${o.quantity})`
      );
      byType[o.breadTypeName].total += o.quantity;
    }

    for (const [type, data] of Object.entries(byType)) {
      lines.push(
        `<b>${type}</b> — ${data.total} ${t('notify.loaves', lang)}`
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

    return lines.join('\n');
  });
}
