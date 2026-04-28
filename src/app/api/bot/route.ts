import { webhookCallback, InlineKeyboard } from 'grammy';
import { ensureBotSetup } from '@/lib/bot';
import { db } from '@/db';
import {
  users,
  groups,
  groupMembers,
  groupInvites,
  orders,
  orderItems,
  customers,
  breadTypes,
} from '@/db/schema';
import { eq, and, gte, lte, ne, asc, inArray } from 'drizzle-orm';
import { t } from '@/lib/i18n';
import { format, addDays } from 'date-fns';
import { notifyMemberJoined, notifyCustomerWhatsApp, notifyPrepayment } from '@/lib/notifications';
import {
  ensureOrderCharge,
  ensureOrderPayment,
  calculateOrderTotal,
  getCustomerBalance,
} from '@/lib/order-payments';

// ---- Helpers ----

async function getOrCreateUser(telegramId: string, name: string) {
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  if (!user) {
    [user] = await db
      .insert(users)
      .values({ telegramId, name })
      .returning();
  }
  return user;
}

async function getUserGroups(userId: number) {
  return db
    .select({
      groupId: groupMembers.groupId,
      groupName: groups.name,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, userId));
}

type Lang = 'en' | 'he';

// ---- Bot handler setup (called lazily on first request) ----

function setupHandlers(bot: import('grammy').Bot) {
  // /start command
  bot.command('start', async (ctx) => {
    const telegramId = String(ctx.from!.id);
    const name = [ctx.from!.first_name, ctx.from!.last_name]
      .filter(Boolean)
      .join(' ');
    const user = await getOrCreateUser(telegramId, name);
    const lang = user.language as Lang;

    // Check for invite deeplink
    const payload = ctx.match;
    if (payload?.startsWith('invite_')) {
      const inviteCode = payload.replace('invite_', '');
      const [invite] = await db
        .select({
          id: groupInvites.id,
          groupId: groupInvites.groupId,
          groupName: groups.name,
          role: groupInvites.role,
          status: groupInvites.status,
          expiresAt: groupInvites.expiresAt,
        })
        .from(groupInvites)
        .innerJoin(groups, eq(groupInvites.groupId, groups.id))
        .where(eq(groupInvites.inviteCode, inviteCode))
        .limit(1);

      if (
        !invite ||
        invite.status !== 'pending' ||
        new Date() > invite.expiresAt
      ) {
        await ctx.reply(
          lang === 'he'
            ? 'ההזמנה לא נמצאה או שפג תוקפה.'
            : 'Invite not found or expired.'
        );
        return;
      }

      const userGroups = await getUserGroups(user.id);
      if (userGroups.some((g) => g.groupId === invite.groupId)) {
        await ctx.reply(
          lang === 'he'
            ? 'את/ה כבר חבר/ת בקבוצה הזו.'
            : 'You are already a member of this group.'
        );
        return;
      }

      const keyboard = new InlineKeyboard()
        .text(t('bot.accept', lang), `accept_invite:${inviteCode}`)
        .text(t('bot.decline', lang), `decline_invite:${inviteCode}`);

      await ctx.reply(
        `${t('bot.invite_join', lang)} "${invite.groupName}" ${t('bot.invite_as', lang)} ${t(`role.${invite.role}`, lang)}?`,
        { reply_markup: keyboard }
      );
      return;
    }

    // Normal /start — always show the Mini App button
    const miniAppUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/miniapp`
      : undefined;

    if (miniAppUrl) {
      await ctx.reply(t('bot.welcome', lang), {
        reply_markup: new InlineKeyboard().webApp(
          t('bot.open_manager', lang),
          miniAppUrl
        ),
      });
    } else {
      await ctx.reply(t('bot.welcome', lang));
    }
  });

  // Invite callbacks
  bot.callbackQuery(/^accept_invite:(.+)$/, async (ctx) => {
    const inviteCode = ctx.match![1];
    const telegramId = String(ctx.from.id);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    if (!user) return;
    const lang = user.language as Lang;

    const [invite] = await db
      .select()
      .from(groupInvites)
      .where(eq(groupInvites.inviteCode, inviteCode))
      .limit(1);

    if (!invite || invite.status !== 'pending') {
      await ctx.answerCallbackQuery(
        lang === 'he' ? 'ההזמנה כבר לא תקפה.' : 'Invite is no longer valid.'
      );
      return;
    }

    await db.insert(groupMembers).values({
      groupId: invite.groupId,
      userId: user.id,
      role: invite.role,
    });

    await db
      .update(groupInvites)
      .set({ status: 'accepted' })
      .where(eq(groupInvites.id, invite.id));

    await notifyMemberJoined(invite.groupId, {
      memberName: user.name,
      role: invite.role,
    });

    await ctx.answerCallbackQuery(
      lang === 'he' ? 'הצטרפת בהצלחה!' : 'Successfully joined!'
    );

    // Show Mini App button so invitee can open the manager
    const miniAppUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/miniapp`
      : undefined;

    if (miniAppUrl) {
      await ctx.editMessageText(
        lang === 'he'
          ? '✅ הצטרפת לקבוצה בהצלחה!'
          : '✅ Successfully joined the group!',
        {
          reply_markup: new InlineKeyboard().webApp(
            t('bot.open_manager', lang),
            miniAppUrl
          ),
        }
      );
    } else {
      await ctx.editMessageText(
        lang === 'he'
          ? '✅ הצטרפת לקבוצה בהצלחה!'
          : '✅ Successfully joined the group!'
      );
    }
  });

  bot.callbackQuery(/^decline_invite:(.+)$/, async (ctx) => {
    const inviteCode = ctx.match![1];

    await db
      .update(groupInvites)
      .set({ status: 'declined' })
      .where(eq(groupInvites.inviteCode, inviteCode));

    await ctx.answerCallbackQuery('OK');
    await ctx.editMessageText('❌');
  });

  // /today command
  // Helper: get items summary for orders
  async function getOrderItemsSummaries(orderIds: number[]) {
    if (orderIds.length === 0) return {};
    const allItems = await db
      .select({
        orderId: orderItems.orderId,
        breadTypeName: breadTypes.name,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
      .where(inArray(orderItems.orderId, orderIds));

    const map: Record<number, { breadTypeName: string; quantity: number }[]> = {};
    for (const item of allItems) {
      if (!map[item.orderId]) map[item.orderId] = [];
      map[item.orderId].push(item);
    }
    return map;
  }

  bot.command('today', async (ctx) => {
    const telegramId = String(ctx.from!.id);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    if (!user) return;
    const lang = user.language as Lang;

    const userGroups = await getUserGroups(user.id);
    if (userGroups.length === 0) {
      await ctx.reply(t('bot.no_orders', lang));
      return;
    }

    const today = format(new Date(), 'yyyy-MM-dd');
    const groupId = userGroups[0].groupId;

    const todayOrders = await db
      .select({
        id: orders.id,
        status: orders.status,
        customerName: customers.name,
        notes: orders.notes,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.groupId, groupId),
          eq(orders.deliveryDate, today),
          ne(orders.status, 'cancelled')
        )
      )
      .orderBy(asc(customers.name));

    if (todayOrders.length === 0) {
      await ctx.reply(t('notify.no_orders_today', lang));
      return;
    }

    const itemsMap = await getOrderItemsSummaries(todayOrders.map((o) => o.id));

    const lines = [`<b>📋 ${t('notify.morning_summary', lang)}</b>`, ''];
    let total = 0;
    for (const o of todayOrders) {
      const items = itemsMap[o.id] || [];
      const summary = items.map((i) => `${i.quantity} ${i.breadTypeName}`).join(', ');
      const qty = items.reduce((s, i) => s + i.quantity, 0);
      const statusEmoji =
        o.status === 'ready' ? '✅' : o.status === 'baking' ? '🔥' : '⏳';
      lines.push(`${statusEmoji} ${o.customerName} — ${summary}`);
      if (o.notes) lines.push(`   💬 ${o.notes}`);
      total += qty;
    }
    lines.push('');
    lines.push(
      `<b>${t('notify.total_today', lang)}:</b> ${total} ${t('notify.loaves', lang)}`
    );

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  // /week command
  bot.command('week', async (ctx) => {
    const telegramId = String(ctx.from!.id);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    if (!user) return;
    const lang = user.language as Lang;

    const userGroups = await getUserGroups(user.id);
    if (userGroups.length === 0) {
      await ctx.reply(t('bot.no_orders', lang));
      return;
    }

    const today = format(new Date(), 'yyyy-MM-dd');
    const weekEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const groupId = userGroups[0].groupId;

    const weekOrders = await db
      .select({
        id: orders.id,
        deliveryDate: orders.deliveryDate,
        status: orders.status,
        customerName: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.groupId, groupId),
          gte(orders.deliveryDate, today),
          lte(orders.deliveryDate, weekEnd),
          ne(orders.status, 'cancelled')
        )
      )
      .orderBy(asc(orders.deliveryDate), asc(customers.name));

    if (weekOrders.length === 0) {
      await ctx.reply(t('bot.no_orders', lang));
      return;
    }

    const itemsMap = await getOrderItemsSummaries(weekOrders.map((o) => o.id));

    const byDate: Record<string, typeof weekOrders> = {};
    for (const o of weekOrders) {
      const d = o.deliveryDate ?? 'ASAP';
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(o);
    }

    const lines = [`<b>📅 ${t('notify.weekly_summary', lang)}</b>`, ''];
    for (const [dateStr, dateOrders] of Object.entries(byDate)) {
      const total = dateOrders.reduce((s, o) => {
        const items = itemsMap[o.id] || [];
        return s + items.reduce((ss, i) => ss + i.quantity, 0);
      }, 0);
      lines.push(
        `<b>${dateStr}</b> (${total} ${t('notify.loaves', lang)})`
      );
      for (const o of dateOrders) {
        const items = itemsMap[o.id] || [];
        const summary = items.map((i) => `${i.quantity} ${i.breadTypeName}`).join(', ');
        lines.push(`  • ${o.customerName} — ${summary}`);
      }
      lines.push('');
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  // /settings command
  bot.command('settings', async (ctx) => {
    const telegramId = String(ctx.from!.id);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    if (!user) return;

    const newLang = user.language === 'he' ? 'en' : 'he';
    const keyboard = new InlineKeyboard().text(
      `🌐 ${newLang === 'en' ? 'English' : 'עברית'}`,
      `set_lang:${newLang}`
    );

    const lang = user.language as Lang;
    await ctx.reply(lang === 'he' ? 'הגדרות:' : 'Settings:', {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^set_lang:(en|he)$/, async (ctx) => {
    const newLang = ctx.match![1] as 'en' | 'he';
    const telegramId = String(ctx.from.id);

    await db
      .update(users)
      .set({ language: newLang })
      .where(eq(users.telegramId, telegramId));

    await ctx.answerCallbackQuery(t('bot.language_updated', newLang));
    await ctx.editMessageText(t('bot.language_updated', newLang));
  });

  // Order status inline buttons
  bot.callbackQuery(/^order_status:(\d+):(\w+)$/, async (ctx) => {
    const orderId = Number(ctx.match![1]);
    const newStatus = ctx.match![2];
    const telegramId = String(ctx.from.id);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    if (!user) return;
    const lang = user.language as Lang;

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return;

    await db
      .update(orders)
      .set({ status: newStatus as any, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    // Record the charge as soon as the order is delivered. Idempotent.
    if (newStatus === 'delivered') {
      await ensureOrderCharge(orderId, order.groupId, order.customerId);
    }

    // Send WhatsApp notification when order is ready
    if (newStatus === 'ready') {
      const [customer] = await db
        .select({ phone: customers.phone })
        .from(customers)
        .where(eq(customers.id, order.customerId))
        .limit(1);
      if (customer) {
        await notifyCustomerWhatsApp(customer.phone);
      }
    }

    await ctx.answerCallbackQuery(`${t(`status.${newStatus}`, lang)} ✅`);
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });

    // Follow up with payment dialog after delivery
    if (newStatus === 'delivered') {
      const total = await calculateOrderTotal(orderId);
      if (total > 0) {
        const [customer] = await db
          .select({ name: customers.name })
          .from(customers)
          .where(eq(customers.id, order.customerId))
          .limit(1);
        const keyboard = new InlineKeyboard()
          .text(`✅ ${t('bot.paid_in_full', lang)}`, `order_pay:${orderId}:paid`)
          .text(`📝 ${t('bot.to_be_paid', lang)}`, `order_pay:${orderId}:unpaid`);
        const lines = [
          `<b>${customer?.name ?? ''}</b>`,
          `${t('bot.payment_question', lang)}`,
          `${t('bot.amount', lang)}: ₪${total.toFixed(0)}`,
        ];
        await ctx.reply(lines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      }
    }
  });

  // Payment dialog inline buttons (after delivery)
  bot.callbackQuery(/^order_pay:(\d+):(\w+)$/, async (ctx) => {
    const orderId = Number(ctx.match![1]);
    const action = ctx.match![2];
    const telegramId = String(ctx.from.id);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    if (!user) return;
    const lang = user.language as Lang;

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return;

    if (action === 'paid') {
      const total = await calculateOrderTotal(orderId);
      const amount = total.toFixed(2);
      await ensureOrderPayment(orderId, order.groupId, order.customerId, amount);
      await db
        .update(orders)
        .set({ paid: true, updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      const [customer] = await db
        .select({ name: customers.name })
        .from(customers)
        .where(eq(customers.id, order.customerId))
        .limit(1);
      const balance = await getCustomerBalance(order.customerId, order.groupId);
      if (customer) {
        await notifyPrepayment(order.groupId, {
          customerName: customer.name,
          amount,
          balance: Number(balance),
        });
      }

      await ctx.answerCallbackQuery(`✅ ${t('bot.payment_recorded', lang)}`);
      await ctx.editMessageText(
        `✅ ${t('bot.payment_recorded', lang)}: ₪${total.toFixed(0)}`
      );
    } else {
      // 'unpaid' — charge is already recorded by the deliver handler,
      // paid flag stays false. Just acknowledge and clear the keyboard.
      await ctx.answerCallbackQuery(`📝 ${t('bot.marked_to_be_paid', lang)}`);
      await ctx.editMessageText(`📝 ${t('bot.marked_to_be_paid', lang)}`);
    }
  });
}

// Webhook handler — lazily initializes bot on first request
export async function POST(request: Request) {
  const bot = ensureBotSetup(setupHandlers);
  const handler = webhookCallback(bot, 'std/http', {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
  return handler(request);
}
