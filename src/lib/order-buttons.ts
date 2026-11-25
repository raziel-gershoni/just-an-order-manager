import { after } from 'next/server';
import { GrammyError } from 'grammy';
import type { InlineKeyboardButton } from 'grammy/types';
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orders, tgOrderButtons } from '@/db/schema';
import { getBot } from './bot';
import { outboundAllowed, logSuppressed } from './outbound';

/**
 * The bot's order buttons, kept in step with the order: אשר on a new order and
 * in the morning approval list, נמסר on a ready order, שולם in the morning
 * unpaid list. Every message that carries them is recorded when it is sent
 * (`tg_order_buttons`), and whenever an order's status or paid flag changes,
 * from the app or from any chat, the buttons that no longer apply are taken off
 * every copy. The text stays as sent.
 *
 * A button never comes back: an order stepped back and made ready again gets a
 * fresh ready message. Messages sent before this existed, and messages older
 * than TRACK_DAYS, keep what they show; the bot checks every tap against the
 * same rule (`orderButtonApplies`), so a button left behind can't act on an
 * order that moved on, and a tap on it takes it off.
 *
 * The edits run after the response (an order unpaid for weeks sits on a list
 * every morning, so paying it can touch dozens of messages), one at a time per
 * chat, waiting when Telegram asks to slow down. Limit: two changes to orders
 * on the same list in the same instant can each edit it from their own read,
 * and the older edit can land last and leave a button that no longer applies;
 * nothing tracks it then, and a tap on it is refused and takes it off.
 */

export type OrderButtonAction = 'confirm' | 'deliver' | 'pay';

const ACTIONS: readonly OrderButtonAction[] = ['confirm', 'deliver', 'pay'];

/** How long a sent button is kept in step. */
const TRACK_DAYS = 30;

/** Tries per edit when Telegram answers 429 (too many requests). */
const EDIT_ATTEMPTS = 3;

/** The callback data of an order button, as the bot route matches it. */
export function orderButtonData(action: OrderButtonAction, orderId: number): string {
  switch (action) {
    case 'confirm':
      return `order_status:${orderId}:confirmed`;
    case 'deliver':
      return `order_status:${orderId}:delivered`;
    case 'pay':
      return `order_pay:${orderId}:paid`;
  }
}

/** The order button behind callback data, or null for any other button (📝, a link). */
export function parseOrderButton(
  data: string | undefined
): { orderId: number; action: OrderButtonAction } | null {
  const m = data?.match(/^order_(?:status|pay):(\d+):\w+$/);
  if (!m) return null;
  const orderId = Number(m[1]);
  const action = ACTIONS.find((a) => orderButtonData(a, orderId) === data);
  return action ? { orderId, action } : null;
}

/**
 * Whether a button still does what it says: אשר while the order waits for
 * approval, נמסר while it is ready, שולם while it is delivered and not paid.
 */
export function orderButtonApplies(
  action: OrderButtonAction,
  order: { status: string; paid: boolean }
): boolean {
  switch (action) {
    case 'confirm':
      return order.status === 'pending';
    case 'deliver':
      return order.status === 'ready';
    case 'pay':
      return order.status === 'delivered' && !order.paid;
  }
}

/**
 * Record a keyboard just sent to these chats. Only a keyboard made entirely of
 * order buttons is recorded: the message is rebuilt from these rows when a
 * button goes, and a button missing from them would be lost. Never throws: the
 * messages went out either way.
 */
export async function recordOrderButtons(
  sent: { chatId: string; messageId: number }[],
  keyboard: InlineKeyboardButton[][] | undefined
): Promise<void> {
  if (!keyboard || sent.length === 0) return;
  const buttons: { position: number; label: string; data: string; orderId: number; action: OrderButtonAction }[] = [];
  for (const [position, row] of keyboard.entries()) {
    for (const button of row) {
      const data = 'callback_data' in button ? button.callback_data : undefined;
      const parsed = parseOrderButton(data);
      if (!data || !parsed) return;
      buttons.push({ position, label: button.text, data, ...parsed });
    }
  }
  if (buttons.length === 0) return;

  try {
    await db.insert(tgOrderButtons).values(
      sent.flatMap((m) =>
        buttons.map((b) => ({
          chatId: m.chatId,
          messageId: m.messageId,
          position: b.position,
          orderId: b.orderId,
          action: b.action,
          label: b.label,
          callbackData: b.data,
        }))
      )
    );
    await db
      .delete(tgOrderButtons)
      .where(lt(tgOrderButtons.createdAt, sql`now() - make_interval(days => ${TRACK_DAYS})`));
  } catch (err) {
    console.error('[order-buttons] recording sent buttons failed; these messages keep the buttons they were sent with', {
      messages: sent.length,
      orderIds: [...new Set(buttons.map((b) => b.orderId))],
    }, err);
  }
}

/**
 * Whether this button on this message is kept in step here, so a tap on it
 * leaves the editing to refreshOrderButtons. False on a failed read: the bot
 * then takes the button off the tapped message itself, as before tracking.
 */
export async function isTrackedButton(
  chatId: number | string,
  messageId: number,
  callbackData: string
): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: tgOrderButtons.id })
      .from(tgOrderButtons)
      .where(
        and(
          eq(tgOrderButtons.chatId, String(chatId)),
          eq(tgOrderButtons.messageId, messageId),
          eq(tgOrderButtons.callbackData, callbackData)
        )
      )
      .limit(1);
    return !!row;
  } catch (err) {
    console.error('[order-buttons] tracked-button read failed', { chatId, messageId, callbackData }, err);
    return false;
  }
}

/**
 * refreshOrderButtons once the response has gone out, so neither a screen nor
 * a tap waits on the edits. Never throws; if the refresh can't be put off it
 * runs now (and says so).
 */
export async function refreshOrderButtonsAfterResponse(orderIds: number[]): Promise<void> {
  try {
    after(() => refreshOrderButtons(orderIds));
  } catch (err) {
    console.error('[order-buttons] could not run the refresh after the response, running it now', { orderIds }, err);
    await refreshOrderButtons(orderIds);
  }
}

/**
 * Take the buttons that no longer apply off every recorded message carrying a
 * button for one of these orders. Call it after anything that changes an
 * order's status or paid flag. Never throws: the change it follows is already
 * saved, and a button left behind is still checked when tapped.
 */
export async function refreshOrderButtons(orderIds: number[]): Promise<void> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return;
  try {
    const messages = await db
      .selectDistinct({ chatId: tgOrderButtons.chatId, messageId: tgOrderButtons.messageId })
      .from(tgOrderButtons)
      .where(inArray(tgOrderButtons.orderId, ids));
    if (messages.length === 0) return;
    if (!outboundAllowed()) {
      logSuppressed(`Telegram button update on ${messages.length} message(s) for order(s) ${ids.join(', ')}`);
      return;
    }

    // Every button on those messages, not only these orders': a morning list
    // carries several orders, and a keyboard is replaced whole.
    const rows = await db
      .select({
        id: tgOrderButtons.id,
        chatId: tgOrderButtons.chatId,
        messageId: tgOrderButtons.messageId,
        position: tgOrderButtons.position,
        action: tgOrderButtons.action,
        label: tgOrderButtons.label,
        callbackData: tgOrderButtons.callbackData,
        status: orders.status,
        paid: orders.paid,
      })
      .from(tgOrderButtons)
      .innerJoin(orders, eq(orders.id, tgOrderButtons.orderId))
      .where(
        or(...messages.map((m) => and(eq(tgOrderButtons.chatId, m.chatId), eq(tgOrderButtons.messageId, m.messageId))))
      )
      .orderBy(asc(tgOrderButtons.position), asc(tgOrderButtons.id));

    // Chats in parallel, each chat's messages one at a time: Telegram limits
    // how fast one chat can be written to.
    const byChat = new Map<string, Map<number, ButtonRow[]>>();
    for (const r of rows) {
      const chat = byChat.get(r.chatId) ?? new Map<number, ButtonRow[]>();
      chat.set(r.messageId, [...(chat.get(r.messageId) ?? []), r]);
      byChat.set(r.chatId, chat);
    }
    await Promise.all(
      [...byChat.values()].map(async (chat) => {
        for (const buttons of chat.values()) await updateMessage(buttons);
      })
    );
  } catch (err) {
    console.error('[order-buttons] refresh failed', { orderIds: ids }, err);
  }
}

type ButtonRow = {
  id: number;
  chatId: string;
  messageId: number;
  position: number;
  action: OrderButtonAction;
  label: string;
  callbackData: string;
  status: string;
  paid: boolean;
};

/** One message: drop its buttons that no longer apply. Never throws. */
async function updateMessage(buttons: ButtonRow[]): Promise<void> {
  const { chatId, messageId } = buttons[0];
  const stale = buttons.filter((b) => !orderButtonApplies(b.action, b));
  if (stale.length === 0) return;
  const removed = stale.map((b) => b.callbackData);

  const rows = new Map<number, InlineKeyboardButton[]>();
  for (const b of buttons) {
    if (!orderButtonApplies(b.action, b)) continue;
    rows.set(b.position, [...(rows.get(b.position) ?? []), { text: b.label, callback_data: b.callbackData }]);
  }
  const keyboard = [...rows.values()];

  let forget = stale;
  try {
    await editKeyboard(chatId, messageId, keyboard);
    console.info('[order-buttons] removed', { chatId, messageId, removed, left: keyboard.length });
  } catch (err) {
    if (err instanceof GrammyError && /message is not modified/i.test(err.description)) {
      // Already showing exactly this: another change got there first.
    } else if (err instanceof GrammyError && (err.error_code === 400 || err.error_code === 403)) {
      // The message or the chat is gone (deleted, bot blocked): nothing left to keep in step.
      console.warn('[order-buttons] message can no longer be edited, forgetting it', {
        chatId,
        messageId,
        code: err.error_code,
        description: err.description,
      });
      forget = buttons;
    } else {
      // Kept: the next change to one of its orders, or a tap, tries again.
      console.error('[order-buttons] edit failed', { chatId, messageId, removed }, err);
      return;
    }
  }

  try {
    await db.delete(tgOrderButtons).where(inArray(tgOrderButtons.id, forget.map((b) => b.id)));
  } catch (err) {
    console.error('[order-buttons] forgetting removed buttons failed', { chatId, messageId, removed }, err);
  }
}

/** Replace a message's keyboard (none when empty), waiting as long as a 429 asks. */
async function editKeyboard(chatId: string, messageId: number, keyboard: InlineKeyboardButton[][]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await getBot().api.editMessageReplyMarkup(
        chatId,
        messageId,
        keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : undefined
      );
      return;
    } catch (err) {
      const retryAfter = err instanceof GrammyError && err.error_code === 429 ? err.parameters.retry_after : undefined;
      if (retryAfter === undefined || attempt >= EDIT_ATTEMPTS) throw err;
      console.warn('[order-buttons] Telegram asked to slow down', { chatId, messageId, retryAfter, attempt });
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    }
  }
}
