import { webhookCallback, InlineKeyboard } from 'grammy';
import { ensureBotSetup } from '@/lib/bot';
import { db } from '@/db';
import {
  users,
  groups,
  groupMembers,
  groupInvites,
  orders,
  customers,
  breadTypes,
} from '@/db/schema';
import { eq, and, gte, lte, ne, asc } from 'drizzle-orm';
import { t } from '@/lib/i18n';
import { format, addDays } from 'date-fns';
import { notifyMemberJoined } from '@/lib/notifications';

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
    await ctx.editMessageText(
      lang === 'he'
        ? '✅ הצטרפת לקבוצה בהצלחה!'
        : '✅ Successfully joined the group!'
    );
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
        quantity: orders.quantity,
        status: orders.status,
        customerName: customers.name,
        breadTypeName: breadTypes.name,
        notes: orders.notes,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .innerJoin(breadTypes, eq(orders.breadTypeId, breadTypes.id))
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

    const lines = [`<b>📋 ${t('notify.morning_summary', lang)}</b>`, ''];
    let total = 0;
    for (const o of todayOrders) {
      const statusEmoji =
        o.status === 'ready' ? '✅' : o.status === 'baking' ? '🔥' : '⏳';
      lines.push(
        `${statusEmoji} ${o.customerName} — ${o.quantity} ${o.breadTypeName}`
      );
      if (o.notes) lines.push(`   💬 ${o.notes}`);
      total += o.quantity;
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
        quantity: orders.quantity,
        deliveryDate: orders.deliveryDate,
        status: orders.status,
        customerName: customers.name,
        breadTypeName: breadTypes.name,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .innerJoin(breadTypes, eq(orders.breadTypeId, breadTypes.id))
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

    const byDate: Record<string, typeof weekOrders> = {};
    for (const o of weekOrders) {
      const d = o.deliveryDate ?? 'ASAP';
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(o);
    }

    const lines = [`<b>📅 ${t('notify.weekly_summary', lang)}</b>`, ''];
    for (const [dateStr, dateOrders] of Object.entries(byDate)) {
      const total = dateOrders.reduce((s, o) => s + o.quantity, 0);
      lines.push(
        `<b>${dateStr}</b> (${total} ${t('notify.loaves', lang)})`
      );
      for (const o of dateOrders) {
        lines.push(
          `  • ${o.customerName} — ${o.quantity} ${o.breadTypeName}`
        );
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

    await ctx.answerCallbackQuery(`${t(`status.${newStatus}`, lang)} ✅`);
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
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
