import { getBot } from './bot';
import { escapeHtml } from './telegram-html';
import { outboundAllowed, logSuppressed } from './outbound';
import { GrammyError, InlineKeyboard, InputFile } from 'grammy';
import { db } from '@/db';
import { groupMembers, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { t } from './i18n';
import { sendWhatsAppTemplate } from './whatsapp';
import { daysAgoLabel, formatWeekdayShort } from './date-utils';
import { siteBaseUrl } from './site-url';
import type { InboundContent, InboundItem, MediaKind } from './whatsapp-inbound';

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

/** Shared with the bot and the cron digests — see src/lib/telegram-html.ts. */
const esc = escapeHtml;

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
  // A branch isolates the database, not Telegram. Without this, testing a
  // delivery against a scratch branch messages the real owner and the real
  // baker about an order that does not exist outside it.
  if (!outboundAllowed()) {
    logSuppressed(`Telegram message to ${recipients.length} recipient(s)`);
    return { sent: 0, failed: 0 };
  }

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
    /**
     * A renewal that was meant to carry a change saved "from the next
     * occurrence": 'applied' when it does, 'failed' when the plain copy was
     * made instead — the baker hears either way, since nothing else will say.
     */
    nextChange?: 'applied' | 'failed' | null;
    /** A renewal made by skipping a week: the day that was skipped. */
    skippedDate?: string | null;
  }
) {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  const keyboard = new InlineKeyboard()
    .text('אשר ✅', `order_status:${orderId}:confirmed`);

  await sendToRecipients(recipients, (lang) => {
    const lines = order.isRenewal
      ? [`<b>🔁 ${t('notify.recurring_renewed', lang)}</b>`, RULE]
      : [`<b>🍞 ${t('notify.new_order', lang)}</b>`, ``];
    if (order.skippedDate) lines.push(`⏭️ ${t('notify.skipped', lang).replace('{date}', formatWeekdayShort(order.skippedDate))}`);
    if (order.nextChange === 'applied') lines.push(`✏️ ${t('notify.next_change_applied', lang)}`);
    if (order.nextChange === 'failed') lines.push(`⚠️ ${t('notify.next_change_failed', lang)}`);
    lines.push(`<b>${t('notify.customer', lang)}:</b> ${esc(order.customerName)}`);
    for (const item of order.items) {
      lines.push(`  • ${item.quantity} ${esc(item.breadTypeName)}`);
    }
    if (order.deliveryDate) {
      lines.push(
        `<b>${t('notify.delivery_date', lang)}:</b> ${formatWeekdayShort(order.deliveryDate)}`
      );
    } else {
      lines.push(`<b>${t('notify.delivery_date', lang)}:</b> ${t('delivery.asap', lang)}`);
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

  // The title counts every one, not just those that fit: the kitchen screen shows the same total.
  const total = pending.length + more;
  return sendToRecipients(recipients, (lang) => {
    const title =
      total === 1
        ? t('notify.pending_one', lang)
        : `${total} ${t('notify.pending_many', lang)}`;
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
 * Daily nudge: orders whose day has passed but that are still open. The same
 * people as the approval nudge, and deliberately without buttons: the fix
 * differs per order (deliver, cancel or move the date), only a `ready` order
 * can be delivered in one step, and delivering creates the charge and can
 * message the customer, days late.
 */
export async function notifyOverdueOrders(
  groupId: number,
  overdue: { id: number; customerName: string; deliveryDate: string | null; status: string }[],
  more: number
): Promise<{ sent: number; failed: number }> {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  const total = overdue.length + more;

  return sendToRecipients(recipients, (lang) => {
    const title =
      total === 1 ? t('notify.overdue_one', lang) : t('notify.overdue_many', lang).replace('{n}', String(total));
    const lines = [`<b>⏰ ${title}</b>`, RULE];
    for (const o of overdue) {
      const when = o.deliveryDate ? formatWeekdayShort(o.deliveryDate) : t('delivery.asap', lang);
      lines.push(`<b>#${o.id} ${esc(o.customerName)}</b> — ${when} · ${t(`status.${o.status}`, lang)}`);
    }
    if (more > 0) lines.push(``, `<i>${t('notify.and_more', lang)} ${more}</i>`);
    lines.push(``, `<i>${t('notify.open_orders_tab', lang)}</i>`);
    return lines.join('\n');
  });
}

/**
 * Daily nudge: orders delivered a while back that were never marked paid, each
 * with a one-tap שולם button. Managers, not bakers — this is a money list.
 */
export async function notifyUnpaidOrders(
  groupId: number,
  unpaid: { id: number; customerName: string; date: string; owed: number }[],
  more: number
): Promise<{ sent: number; failed: number }> {
  const recipients = await getRecipientsByRole(groupId, ['manager']);
  const keyboard = new InlineKeyboard();
  unpaid.forEach((o, i) => {
    if (i > 0) keyboard.row();
    keyboard.text(
      `${t('notify.mark_paid')} · #${o.id} ${shortName(o.customerName)} ₪${o.owed.toFixed(0)}`,
      `order_pay:${o.id}:paid`
    );
  });

  // The title counts every one, not just those that fit.
  const total = unpaid.length + more;
  return sendToRecipients(recipients, (lang) => {
    const title =
      total === 1
        ? t('notify.unpaid_one', lang)
        : `${total} ${t('notify.unpaid_many', lang)}`;
    const lines = [`<b>💰 ${title}</b>`, RULE];
    for (const o of unpaid) {
      lines.push(
        `<b>#${o.id} ${esc(o.customerName)}</b> — ₪${o.owed.toFixed(0)} · ${daysAgoLabel(o.date)}`
      );
    }
    if (more > 0) lines.push(``, `<i>${t('notify.and_more', lang)} ${more}</i>`);
    return lines.join('\n');
  }, keyboard);
}

/**
 * The recurring reminder hasn't run. Owner/manager only — it's an ops problem,
 * not something the baker can act on — and deliberately without a button: there
 * is nothing to tap, the fix is a schedule outside the app.
 */
export async function notifyRemindersStalled(
  groupId: number,
  missed: { orderId: number; customerName: string; deliveryDate: string }[],
  // Where to look: sends that all failed are a WhatsApp problem, no sends at
  // all are a schedule problem. Naming the wrong one sent the owner to check
  // three healthy QStash entries, every morning, until he stopped reading it.
  cause: 'schedule' | 'delivery' = 'schedule'
): Promise<{ sent: number; failed: number }> {
  const recipients = await getRecipientsByRole(groupId, ['manager']);

  return sendToRecipients(recipients, (lang) => {
    const lines = [`<b>⚠️ ${t('notify.reminders_stalled', lang)}</b>`, RULE];
    for (const m of missed) {
      lines.push(
        `<b>#${m.orderId} ${esc(m.customerName)}</b> — ${formatWeekdayShort(m.deliveryDate)}`
      );
    }
    const hint =
      cause === 'delivery'
        ? t('notify.reminders_stalled_delivery', lang)
        : t('notify.reminders_stalled_hint', lang);
    lines.push(``, `<i>${hint}</i>`);
    return lines.join('\n');
  });
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

/**
 * 💰 to the baker and the owner. Money paid ahead for an order (`order`) names
 * that order instead of the balance: before delivery nothing is charged yet,
 * so the balance would call the money loose credit.
 */
export async function notifyPrepayment(
  groupId: number,
  data: {
    customerName: string;
    amount: string;
    balance: number;
    order?: { id: number; due: number };
  }
) {
  const recipients = await getRecipientsByRole(groupId, ['baker']);
  await sendToRecipients(recipients, (lang) => {
    const order = data.order;
    const lines = [
      `<b>💰 ${esc(data.customerName)} ${t('notify.prepayment', lang)} ₪${data.amount}${order ? ` ${t('notify.prepaid_suffix', lang)}` : ''}</b>`,
    ];
    if (order) {
      lines.push(
        order.due > 0
          ? t('notify.prepaid_due', lang).replace('{id}', String(order.id)).replace('{due}', order.due.toFixed(0))
          : `✅ ${t('notify.prepaid_settled', lang).replace('{id}', String(order.id))}`
      );
    } else if (data.balance === 0) {
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
  bake: {
    today: { customerName: string; breadTypeName: string; quantity: number }[];
    /** Open בהקדם lines when they are kept apart from today; empty when the switch has them inside today. */
    asap: { customerName: string; breadTypeName: string; quantity: number }[];
    recipeBlock?: string;
  }
): Promise<{ sent: number; failed: number }> {
  if (bake.today.length === 0 && bake.asap.length === 0) return { sent: 0, failed: 0 };

  const recipients = await getRecipientsByRole(groupId, ['baker']);
  return await sendToRecipients(recipients, (lang) => {
    const lines = [`<b>📋 ${t('notify.morning_summary', lang)}</b>`, ''];

    // One block per bread type, with who ordered it
    const typeBlock = (rows: typeof bake.today) => {
      const byType: Record<string, { customers: string[]; total: number }> = {};
      for (const o of rows) {
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
    };
    const loaves = (rows: typeof bake.today) => rows.reduce((sum, o) => sum + o.quantity, 0);

    if (bake.asap.length > 0) {
      lines.push(`<b>${t('delivery.asap', lang)}</b>`);
      typeBlock(bake.asap);
      lines.push(`<b>${t('notify.total_asap', lang)}:</b> ${loaves(bake.asap)} ${t('notify.loaves', lang)}`);
      lines.push('');
      lines.push(`<b>${t('dash.today', lang)}</b>`);
    }

    if (bake.today.length === 0) {
      lines.push(t('notify.no_orders_today', lang));
    } else {
      typeBlock(bake.today);
      lines.push(
        `<b>${t('notify.total_today', lang)}:</b> ${loaves(bake.today)} ${t('notify.loaves', lang)}`
      );
      if (bake.recipeBlock) {
        lines.push('', bake.recipeBlock);
      }
    }

    return lines.join('\n');
  });
}

// ---- A customer's WhatsApp message, forwarded to Telegram ----

/** What became of the file a message carried. */
export type ForwardedFile =
  | { state: 'ready'; bytes: Buffer; mimeType: string | null }
  | { state: 'too_big'; sizeBytes: number }
  | { state: 'unavailable' };

export interface WhatsAppForward {
  sender: InboundItem['sender'];
  content: InboundContent;
  /** Null for a message without a file. Fetched once, shared by every recipient. */
  file: ForwardedFile | null;
}

/** One group to tell, with the customers of that group the sender's number belongs to. */
export interface WhatsAppForwardTarget {
  groupId: number;
  customers: { id: number; name: string }[];
}

// Telegram: 4096 characters a message, 1024 a caption. HTML length is counted,
// which is at least the visible length, so the limits are never exceeded.
const TG_TEXT_LIMIT = 4000;
const TG_CAPTION_LIMIT = 1024;
/** The "MB" of Telegram's 50 MB file limit and of the size shown to the owner. */
export const BYTES_PER_MB = 1000 * 1000;

/** Digits stay left-to-right inside Hebrew text only when isolated (U+2066 ... U+2069). */
const isolate = (s: string) => `\u2066${s}\u2069`;

/** Escaped chunks of `raw`, none longer than the limit once escaped; the first has its own, smaller room. */
function splitEscaped(raw: string, firstLimit: number, restLimit: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  let limit = Math.max(firstLimit, 1);
  for (const ch of Array.from(raw)) {
    const piece = esc(ch);
    if (cur.length + piece.length > limit) {
      chunks.push(cur);
      cur = '';
      limit = restLimit;
    }
    cur += piece;
  }
  if (cur || chunks.length === 0) chunks.push(cur);
  return chunks;
}

function senderLine(sender: InboundItem['sender'], customers: WhatsAppForwardTarget['customers']): string {
  if (customers.length > 0) {
    return `<b>${t('notify.customer')}:</b> ${customers.map((c) => esc(c.name)).join(' / ')}`;
  }
  const who = [
    sender.name ? esc(sender.name) : null,
    sender.phone ? isolate(`+${sender.phone}`) : t('notify.wa_unknown_number'),
  ].filter(Boolean);
  return `<b>${t('notify.wa_from')}:</b> ${who.join(' ')}`;
}

/** Hebrew name of a WhatsApp message type; the raw type (logged by the handler) never reaches the owner. */
function typeLabel(type: string): string {
  for (const key of [`notify.wa_type.${type}`, `notify.wa_media.${type}`]) {
    const label = t(key);
    if (label !== key) return label;
  }
  return t('notify.wa_type.unknown');
}

/** What to log of a failed Telegram call: grammY's own error carries the whole request, message text included. */
function describeSendError(err: unknown): unknown {
  return err instanceof GrammyError ? { method: err.method, code: err.error_code, description: err.description } : err;
}

/** The part of the message after the header: an HTML lead line and the raw (long, unescaped) text. */
function describeContent(content: InboundContent, file: ForwardedFile | null): { lead: string[]; text: string } {
  switch (content.kind) {
    case 'text':
      return { lead: [], text: content.text };
    case 'media': {
      const kind = t(`notify.wa_media.${content.media}`);
      const lead: string[] = [];
      if (file?.state === 'too_big') {
        lead.push(`<i>${t('notify.wa_media_too_big').replace('{kind}', kind).replace('{size}', (file.sizeBytes / BYTES_PER_MB).toFixed(1))}</i>`);
      } else if (file?.state === 'unavailable') {
        lead.push(`<i>${t('notify.wa_media_failed').replace('{kind}', kind)}</i>`);
      }
      return { lead, text: content.caption ?? '' };
    }
    case 'location':
      return { lead: [t('notify.wa_location')], text: [content.name, content.address].filter(Boolean).join('\n') };
    case 'contacts':
      return {
        lead: [t('notify.wa_contacts')],
        text: content.lines
          .map((c) => [c.name, ...c.phones.map(isolate)].filter(Boolean).join(' — '))
          .join('\n'),
      };
    case 'reaction':
      return { lead: [`${t('notify.wa_reacted')} ${esc(content.emoji)}`], text: '' };
    case 'reaction_removed':
      return { lead: [], text: '' };
    case 'other':
      return { lead: [`${t('notify.wa_unsupported')} (${typeLabel(content.type)})`], text: '' };
  }
}

interface ForwardPlan {
  /** Text messages, in order; the first carries the button. */
  parts: string[];
  /** Caption of the file, when there is one to send. */
  fileCaption: string | null;
  keyboard?: InlineKeyboard;
}

function planForward(msg: WhatsAppForward, target: WhatsAppForwardTarget): ForwardPlan {
  const head = `<b>💬 ${t('notify.wa_message')}</b>\n${senderLine(msg.sender, target.customers)}`;
  const { lead, text } = describeContent(msg.content, msg.file);
  const info = lead.join('\n');
  const keyboard =
    target.customers.length === 1
      ? new InlineKeyboard().webApp(
          t('notify.wa_open_customer'),
          `${siteBaseUrl()}/miniapp/customers/${target.customers[0].id}`
        )
      : undefined;

  const prefix = (info ? `${head}\n\n${info}` : head) + (text ? (info ? '\n' : '\n\n') : '');
  const chunks = text ? splitEscaped(text, TG_TEXT_LIMIT - prefix.length, TG_TEXT_LIMIT) : [];
  const parts = chunks.length ? [prefix + chunks[0], ...chunks.slice(1)] : [prefix];

  if (msg.file?.state === 'ready') {
    // The header rides on the file itself when it and the caption fit; otherwise
    // the text goes first and the file keeps just the header.
    if (parts.length === 1 && parts[0].length <= TG_CAPTION_LIMIT) {
      return { parts: [], fileCaption: parts[0], keyboard };
    }
    return { parts, fileCaption: head, keyboard };
  }
  return { parts, fileCaption: null, keyboard };
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'application/pdf': 'pdf',
};

function fileName(media: MediaKind, filename: string | null, mimeType: string | null): string {
  if (filename) return filename;
  const ext = MIME_EXT[(mimeType ?? '').split(';')[0].trim()] ?? 'bin';
  return `${media}.${ext}`;
}

/**
 * The file itself, as Telegram's matching kind. A sticker goes as a document:
 * sendSticker takes only the strict 512 px formats and refuses the animated
 * ones. When Telegram refuses a photo, video or audio (dimensions, codec) the
 * file is re-sent as a document rather than lost: nobody can open this number
 * in a WhatsApp app to fetch it from there.
 */
async function sendForwardedFile(
  chatId: string,
  content: Extract<InboundContent, { kind: 'media' }>,
  file: Extract<ForwardedFile, { state: 'ready' }>,
  opts: { caption: string; parse_mode: 'HTML'; reply_markup?: InlineKeyboard }
): Promise<void> {
  const api = getBot().api;
  const name = fileName(content.media, content.filename, file.mimeType ?? content.mimeType);
  const input = () => new InputFile(file.bytes, name);
  const mime = (file.mimeType ?? content.mimeType ?? '').toLowerCase();
  try {
    switch (content.media) {
      case 'image': await api.sendPhoto(chatId, input(), opts); return;
      case 'video': await api.sendVideo(chatId, input(), opts); return;
      case 'voice':
        if (mime.startsWith('audio/ogg')) { await api.sendVoice(chatId, input(), opts); return; }
        await api.sendAudio(chatId, input(), opts); return;
      case 'audio': await api.sendAudio(chatId, input(), opts); return;
      case 'document':
      case 'sticker': break;
    }
  } catch (err) {
    console.warn(`[wa-webhook] Telegram refused the ${content.media}, sending it as a document:`, describeSendError(err));
  }
  await api.sendDocument(chatId, input(), opts);
}

async function deliverForward(chatId: string, msg: WhatsAppForward, plan: ForwardPlan): Promise<void> {
  const api = getBot().api;
  let keyboard = plan.keyboard;
  for (const part of plan.parts) {
    await api.sendMessage(chatId, part, { parse_mode: 'HTML', reply_markup: keyboard });
    keyboard = undefined;
  }
  if (plan.fileCaption !== null && msg.content.kind === 'media' && msg.file?.state === 'ready') {
    await sendForwardedFile(chatId, msg.content, msg.file, {
      caption: plan.fileCaption,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
  if (msg.content.kind === 'location') {
    await api.sendLocation(chatId, msg.content.latitude, msg.content.longitude);
  }
}

/**
 * Forward a customer's WhatsApp message to the owner and managers of each
 * target group. One recipient failing doesn't stop the others and is logged
 * like any send; when NOBODY got it this throws, so the caller can release its
 * dedupe claim and let Meta's retry bring the message back. Partial success
 * counts as delivered. Nothing is sent (and nothing thrown) when outbound is
 * disabled or no group has a recipient.
 */
export async function notifyWhatsAppMessage(
  targets: WhatsAppForwardTarget[],
  msg: WhatsAppForward
): Promise<{ sent: number; failed: number }> {
  const jobs: { chatId: string; plan: ForwardPlan }[] = [];
  for (const target of targets) {
    const recipients = await getRecipientsByRole(target.groupId, ['manager']);
    if (recipients.length === 0) {
      console.warn(`[wa-webhook] group ${target.groupId} has no owner or manager to forward to`);
    }
    const plan = planForward(msg, target);
    for (const r of recipients) jobs.push({ chatId: r.chatId, plan });
  }

  if (!outboundAllowed()) {
    logSuppressed(`WhatsApp message forward to ${jobs.length} recipient(s)`);
    return { sent: 0, failed: 0 };
  }

  const results = await Promise.allSettled(jobs.map((j) => deliverForward(j.chatId, msg, j.plan)));
  let sent = 0;
  let failed = 0;
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
      console.error(`[wa-webhook] Telegram forward failed to chatId ${jobs[i].chatId}:`, describeSendError(res.reason));
    }
  });
  if (sent === 0 && failed > 0) {
    throw new Error(`[wa-webhook] the forward reached none of ${failed} recipient(s)`);
  }
  return { sent, failed };
}
