import { after } from 'next/server';
import { webhookCallback, GrammyError, InlineKeyboard, type Context } from 'grammy';
import { ensureBotSetup } from '@/lib/bot';
import { db } from '@/db';
import {
  users,
  groups,
  groupMembers,
  groupInvites,
  customers,
} from '@/db/schema';
import { asc, eq } from 'drizzle-orm';
import { t } from '@/lib/i18n';
import { todayStr, upcomingHorizonStr } from '@/lib/date-utils';
import { recordOrderPayment } from '@/lib/order-payments';
import { transitionOrderStatus } from '@/lib/order-status';
import { buttonTracking, orderButtonApplies, parseOrderButton, refreshOrderButtonsAfterResponse } from '@/lib/order-buttons';
import { resolveBotOrderAccess } from '@/lib/telegram-auth';
import { respondToInvite } from '@/lib/invites';
import { todayDigestText, weekDigestText } from '@/lib/day-digest';
import { siteBaseUrl } from '@/lib/site-url';
import { createDraft, setDraftReply } from '@/lib/order-drafts';
import { resolveDraftSender, processOrderDraft, reportStaleDrafts, type DraftJob } from '@/lib/order-draft-process';

// A dictated order is read after the reply to Telegram, inside after(); 300 s is the Hobby ceiling.
export const maxDuration = 300;

// ---- Helpers ----

/**
 * The message's inline keyboard minus the button that was just pressed.
 *
 * Single-order pings carry one button, so this comes back empty and the caller
 * clears the keyboard exactly as before. The daily nudges pack one button per
 * order into a single message — there, blanket-clearing would disarm every
 * other order the moment one was actioned, so only the pressed row goes.
 */
function keyboardWithoutPressed(ctx: Context) {
  const message = ctx.callbackQuery?.message;
  const rows =
    (message && 'reply_markup' in message ? message.reply_markup?.inline_keyboard : undefined) ?? [];
  const pressed = ctx.callbackQuery?.data;
  return rows
    .map((row) => row.filter((b) => !('callback_data' in b) || b.callback_data !== pressed))
    .filter((row) => row.length > 0);
}

/**
 * How the pressed button's message is kept in step with its order
 * (src/lib/order-buttons.ts): 'buttons' for a recorded keyboard, 'delivered'
 * for a 📦 delivered message. refreshOrderButtons updates every copy of either,
 * so the handlers leave them alone; a button on a message sent before tracking
 * (null) is taken off the tapped message only, as always. Checked before the
 * change, which forgets the button.
 */
async function pressedTracking(ctx: Context): Promise<'buttons' | 'delivered' | null> {
  const message = ctx.callbackQuery?.message;
  const data = ctx.callbackQuery?.data;
  return message && data ? buttonTracking(message.chat.id, message.message_id, data) : null;
}

/**
 * Take the pressed button off a message whose buttons are not tracked.
 * Best-effort: a throw here would make Telegram resend the whole update, and a
 * double tap finds the button already gone ("message is not modified").
 */
async function removePressed(ctx: Context) {
  const remaining = keyboardWithoutPressed(ctx);
  try {
    await ctx.editMessageReplyMarkup(
      remaining.length ? { reply_markup: { inline_keyboard: remaining } } : undefined
    );
  } catch (err) {
    if (err instanceof GrammyError && /message is not modified/i.test(err.description)) return;
    console.error('[bot] taking the pressed button off failed', {
      data: ctx.callbackQuery?.data,
      error: err instanceof GrammyError ? err.description : String(err),
    });
  }
}

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
    .where(eq(groupMembers.userId, userId))
    // /today and /week use the first: the lowest group id, the rule drafts use.
    .orderBy(asc(groupMembers.groupId));
}

type Lang = 'en' | 'he';

/**
 * A voice message or text from staff becomes a draft order. Telegram only gets
 * a 200 once this returns, so the slow part (Gemini) is handed to after().
 * Everything is caught: a thrown handler makes Telegram re-send the update.
 */
async function receiveOrderMessage(ctx: Context, source: 'voice' | 'text') {
  if (ctx.chat?.type !== 'private' || !ctx.from || !ctx.msg) return;
  const telegramId = ctx.from.id;
  try {
    const sender = await resolveDraftSender(String(telegramId));
    if (!sender) {
      console.info('[order-draft] ignored', { telegramId, reason: 'not staff' });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      console.error('[order-draft] GEMINI_API_KEY is not set', { telegramId });
      await ctx.reply(t('bot.draft_not_configured', sender.lang));
      return;
    }
    const draft = await createDraft({
      groupId: sender.groupId,
      createdBy: sender.userId,
      source,
      tgChatId: ctx.chat.id,
      tgMessageId: ctx.msg.message_id,
    });
    if (!draft) {
      console.info('[order-draft] duplicate update', { telegramId, messageId: ctx.msg.message_id });
      return;
    }
    const msg = ctx.msg;
    const job: DraftJob = {
      draftId: draft.id,
      chatId: ctx.chat.id,
      replyMessageId: null,
      groupId: sender.groupId,
      input:
        source === 'voice' && msg.voice
          ? {
              kind: 'voice',
              fileId: msg.voice.file_id,
              fileSize: msg.voice.file_size ?? null,
              mimeType: msg.voice.mime_type ?? null,
              duration: msg.voice.duration,
              caption: msg.caption ?? null,
            }
          : { kind: 'text', text: msg.text ?? '' },
    };
    try {
      const reply = await ctx.reply(t('bot.draft_working', sender.lang));
      job.replyMessageId = reply.message_id;
      await setDraftReply(draft.id, reply.message_id);
    } catch (e) {
      // Without the reply id the answer is sent as a new message instead of an edit.
      console.error('[order-draft] working reply failed', { draftId: draft.id, error: e instanceof Error ? e.message : String(e) });
    } finally {
      after(() => processOrderDraft(job));
      after(() => reportStaleDrafts(job.chatId));
    }
  } catch (e) {
    console.error('[order-draft] handler failed', { telegramId, error: e instanceof Error ? e.message : String(e) });
  }
}

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
      ? `${siteBaseUrl()}/miniapp`
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

    const result = await respondToInvite(inviteCode, 'accept', { id: user.id, name: user.name });
    if (!result.ok) {
      await ctx.answerCallbackQuery(
        lang === 'he' ? 'ההזמנה כבר לא תקפה.' : 'Invite is no longer valid.'
      );
      return;
    }

    await ctx.answerCallbackQuery(
      lang === 'he' ? 'הצטרפת בהצלחה!' : 'Successfully joined!'
    );

    // Show Mini App button so invitee can open the manager
    const miniAppUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${siteBaseUrl()}/miniapp`
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
    const telegramId = String(ctx.from.id);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    // Apply the lifecycle guards when we can resolve the user; always ack so the
    // Telegram button never hangs.
    if (user) {
      await respondToInvite(inviteCode, 'decline', { id: user.id, name: user.name });
    }
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

    const text = await todayDigestText(userGroups[0].groupId, todayStr(), lang);
    await ctx.reply(text ?? t('notify.no_orders_today', lang), text ? { parse_mode: 'HTML' } : undefined);
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

    const text = await weekDigestText(userGroups[0].groupId, todayStr(), upcomingHorizonStr(), lang);
    await ctx.reply(text ?? t('bot.no_orders', lang), text ? { parse_mode: 'HTML' } : undefined);
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

    // Bot-side authorization: same group-membership scoping the web route uses.
    const access = await resolveBotOrderAccess(telegramId, orderId);
    if (!access) return;
    const { user, order, role } = access;
    const lang = user.language as Lang;
    // Drivers may only act on delivery orders (mirror the web route).
    if (role === 'driver' && !order.isDelivery) {
      await ctx.answerCallbackQuery(t('bot.status_change_failed', lang));
      return;
    }

    const tracked = (await pressedTracking(ctx)) !== null;
    // A tap is held to its button's own rule, not only to the state machine,
    // which also allows stepping back: an אשר left on an old message would walk
    // a ready order back to confirmed.
    const button = parseOrderButton(ctx.callbackQuery.data);
    if (button && !orderButtonApplies(button.action, order)) {
      console.info('[bot] order button no longer applies', { orderId, action: button.action, status: order.status });
      await ctx.answerCallbackQuery(t('bot.order_already_updated', lang));
      await refreshOrderButtonsAfterResponse([orderId]);
      if (!tracked) await removePressed(ctx);
      return;
    }

    // Same state machine the web app runs (validation + CAS + charge + recurring
    // clone + notifications + this order's buttons in every chat). Only the auth
    // (above) and the Telegram reply (below) are bot-specific.
    const result = await transitionOrderStatus(order, newStatus, { notifyCustomer: true });
    if (!result.ok) {
      await ctx.answerCallbackQuery(
        result.status === 409
          ? t('bot.order_already_updated', lang)
          : t('bot.status_change_failed', lang)
      );
      return;
    }

    await ctx.answerCallbackQuery(`${t(`status.${newStatus}`, lang)} ✅`);
    if (!tracked) await removePressed(ctx);
    // A delivery is followed by the 📦 delivered message, sent to the owner and
    // the managers by transitionOrderStatus; it asks for the payment itself.
  });

  // Payment buttons: שולם on the delivered message and the unpaid list, and
  // ✅ / 📝 on the payment question the bot asked after a delivery until the
  // delivered message replaced it (such messages are still in the chats).
  bot.callbackQuery(/^order_pay:(\d+):(\w+)$/, async (ctx) => {
    const orderId = Number(ctx.match![1]);
    const action = ctx.match![2];
    const telegramId = String(ctx.from.id);

    const access = await resolveBotOrderAccess(telegramId, orderId);
    if (!access) return;
    const { user, order, role } = access;
    const lang = user.language as Lang;
    if (role === 'driver' && !order.isDelivery) {
      await ctx.answerCallbackQuery(t('bot.status_change_failed', lang));
      return;
    }

    if (action === 'paid') {
      const tracking = await pressedTracking(ctx);
      // A ✅ on an order already paid (settled from the tab, or marked paid in
      // the app) would file the money a second time: the ledger has no payment
      // of its own for it, so the whole total reads as due. 📝 is the way back.
      if (!orderButtonApplies('pay', order)) {
        console.info('[bot] payment button no longer applies', { orderId, status: order.status, paid: order.paid });
        await ctx.answerCallbackQuery(`⚠️ ${t('bot.already_paid', lang)}`);
        await refreshOrderButtonsAfterResponse([orderId]);
        if (!tracking) await removePressed(ctx);
        return;
      }
      const [customer] = await db
        .select({ name: customers.name })
        .from(customers)
        .where(eq(customers.id, order.customerId))
        .limit(1);
      // Shared post-delivery payment sequence (charge + payment + paid + notify).
      // No amount: paid in full, which records what is still due — the total,
      // or the rest of an order paid partly in advance — and nothing on a retry.
      const { outcome, recorded } = await recordOrderPayment(
        { id: order.id, groupId: order.groupId, customerId: order.customerId, customerName: customer?.name ?? '' },
        'paid'
      );

      // These buttons outlive their orders: the unpaid nudge mints a fresh one
      // every morning, and a message sent before buttons were tracked, or more
      // than 30 days ago (src/lib/order-buttons.ts), keeps its ✅. It must never
      // claim to have recorded a payment it did not write.
      // show_alert on the warning: a callback toast fades in a few seconds, and
      // on a multi-order nudge the pressed button just disappears like any other
      // — pixel-identical to a payment that was recorded. This is the one path
      // where money changed hands and nothing was written, so it takes a dialog
      // the owner has to dismiss.
      const notRecorded = outcome === 'already';
      if (notRecorded) {
        await ctx.answerCallbackQuery({
          text: `⚠️ ${t('bot.payment_already', lang)}`,
          show_alert: true,
        });
      } else {
        await ctx.answerCallbackQuery(`✅ ${t('bot.payment_recorded', lang)}`);
      }
      // Rewriting the text is right for the one-order payment dialog, but it
      // would erase a whole unpaid-nudge list; when other orders are still
      // listed, retire just this button and leave the message standing. A
      // tracked list loses it on every copy once the payment is saved, and a
      // delivered message is redrawn on every copy to say it was paid.
      const remaining = keyboardWithoutPressed(ctx);
      if (tracking === 'delivered') {
        // Left to refreshOrderButtons.
      } else if (remaining.length) {
        if (!tracking) await removePressed(ctx);
      } else {
        await ctx.editMessageText(
          notRecorded
            ? `⚠️ ${t('bot.payment_already', lang)}`
            : `✅ ${t('bot.payment_recorded', lang)}${recorded ? `: ₪${Number(recorded).toFixed(0)}` : ''}`
        );
      }
    } else {
      // 'unpaid' — the charge is already recorded by the deliver handler, and
      // this is also the only way back from a ✅ tapped by mistake: both buttons
      // sit in one row, so ✅ leaves 📝 standing, and it used to answer without
      // writing anything at all — the bogus payment stood, the order stayed
      // flagged paid, and the customer kept a credit he never earned.
      const { outcome } = await recordOrderPayment(
        {
          id: order.id,
          groupId: order.groupId,
          customerId: order.customerId,
          customerName: '',
        },
        'unpaid'
      );
      await ctx.answerCallbackQuery(
        outcome === 'undone'
          ? { text: `↩️ ${t('bot.payment_undone', lang)}`, show_alert: true }
          : outcome === 'kept'
            ? { text: `⚠️ ${t('bot.payment_kept', lang)}`, show_alert: true }
            : outcome === 'covered'
              ? { text: `⚠️ ${t('bot.payment_covered', lang)}`, show_alert: true }
              : `📝 ${t('bot.marked_to_be_paid', lang)}`
      );
      const remaining = keyboardWithoutPressed(ctx);
      if (remaining.length) {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: remaining } });
      } else {
        // The message must say what happened, not what was asked for: an order
        // the tab already covers was left exactly as it was.
        await ctx.editMessageText(
          outcome === 'covered'
            ? `⚠️ ${t('bot.payment_covered', lang)}`
            : outcome === 'undone'
              ? `↩️ ${t('bot.payment_undone', lang)}`
              : `📝 ${t('bot.marked_to_be_paid', lang)}`
        );
      }
    }
  });

  // ---- Orders sent as a message (voice or text) ----
  // Registered last: a handled command never calls next(), so it never gets here.
  // An edited message arrives as `edited_message` and matches none of these filters.
  bot.on('message:voice', (ctx) => receiveOrderMessage(ctx, 'voice'));
  bot.on('message:text', (ctx) => {
    // Unknown commands and commands for other bots reach this handler too.
    if (ctx.msg.text.startsWith('/')) return;
    return receiveOrderMessage(ctx, 'text');
  });
  bot.on(
    ['message:audio', 'message:document', 'message:video', 'message:video_note', 'message:photo', 'message:sticker', 'message:animation'],
    async (ctx) => {
      try {
        if (ctx.chat.type !== 'private') return;
        const sender = await resolveDraftSender(String(ctx.from.id));
        if (!sender) return;
        await ctx.reply(t('bot.draft_voice_or_text', sender.lang));
      } catch (e) {
        console.error('[order-draft] other-message reply failed', { telegramId: ctx.from?.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );
}

// Webhook handler — lazily initializes bot on first request
export async function POST(request: Request) {
  const bot = ensureBotSetup(setupHandlers);
  const handler = webhookCallback(bot, 'std/http', {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
  return handler(request);
}
