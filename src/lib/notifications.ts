import { getBot } from './bot';
import { db } from '@/db';
import { groupMembers, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { t } from './i18n';

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
  messageFn: (lang: 'en' | 'he') => string
) {
  const results = await Promise.allSettled(
    recipients.map((r) =>
      getBot().api.sendMessage(r.chatId, messageFn(r.language), {
        parse_mode: 'HTML',
      })
    )
  );
  return results;
}

export async function notifyNewOrder(
  groupId: number,
  order: {
    customerName: string;
    breadTypeName: string;
    quantity: number;
    deliveryDate: string | null;
    notes: string | null;
  }
) {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  await sendToRecipients(recipients, (lang) => {
    const lines = [
      `<b>🍞 ${t('notify.new_order', lang)}</b>`,
      ``,
      `<b>${t('notify.customer', lang)}:</b> ${order.customerName}`,
      `<b>${t('notify.bread_type', lang)}:</b> ${order.breadTypeName}`,
      `<b>${t('notify.quantity', lang)}:</b> ${order.quantity} ${t('notify.loaves', lang)}`,
    ];
    if (order.deliveryDate) {
      lines.push(
        `<b>${t('notify.delivery_date', lang)}:</b> ${order.deliveryDate}`
      );
    }
    if (order.notes) {
      lines.push(`<b>${t('notify.notes', lang)}:</b> ${order.notes}`);
    }
    return lines.join('\n');
  });
}

export async function notifyOrderReady(
  groupId: number,
  order: {
    customerName: string;
    breadTypeName: string;
    quantity: number;
  }
) {
  const recipients = await getRecipientsByRole(groupId, ['manager']);
  await sendToRecipients(recipients, (lang) =>
    [
      `<b>✅ ${t('notify.order_ready', lang)}</b>`,
      ``,
      `${order.customerName} — ${order.quantity} ${order.breadTypeName}`,
    ].join('\n')
  );
}

export async function notifyPrepayment(
  groupId: number,
  data: { customerName: string; amount: string; creditLoaves: number }
) {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  await sendToRecipients(recipients, (lang) =>
    [
      `<b>💰 ${data.customerName} ${t('notify.prepayment', lang)} ₪${data.amount}</b>`,
      `${t('notify.credit_for', lang)} ${data.creditLoaves} ${t('notify.loaves', lang)}`,
    ].join('\n')
  );
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
