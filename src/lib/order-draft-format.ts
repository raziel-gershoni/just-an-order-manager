// The bot's summary of an order read from a message: pure, so it is checked on its
// own and the sender's reply, the edit of "מפענח…" and the fallback message all
// use the same text. The form's banner reuses `draftWarningText` for its warnings.

import { t } from '@/lib/i18n';
import { escapeHtml } from '@/lib/telegram-html';
import { formatStaffItemLabel } from '@/lib/order-display';
import { comingFriday, formatWeekdayShort } from '@/lib/date-utils';
import { draftWarningText, fillText, resolveCustomerCandidates, resolveDraftTiming, type OrderDraft } from '@/lib/order-draft-types';
import type { DraftContext } from '@/lib/order-from-message';

/** Telegram's cap on a text message, counted after entities are parsed. */
export const TELEGRAM_TEXT_LIMIT = 4096;

// What Telegram counts: the text with tags removed and each escaped character as one.
const visibleLength = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&(lt|gt|amp|quot);/g, '_').length;

function customerPart(draft: OrderDraft, ctx: DraftContext): string | null {
  const { spokenName, candidateIds } = draft.customer;
  // Re-resolved, as the form does when it opens: the customers may have changed since.
  const ids = resolveCustomerCandidates(spokenName, candidateIds, ctx.customers);
  const nameOf = (id: number) => ctx.customers.find((c) => c.id === id)?.name ?? null;
  if (ids.length === 1) {
    const name = nameOf(ids[0]) ?? spokenName;
    return name ? `<b>${escapeHtml(name)}</b>` : null;
  }
  if (ids.length > 1) {
    const name = spokenName ?? nameOf(ids[0]);
    return name ? escapeHtml(fillText('bot.draft_several_customers', 'name', name)) : null;
  }
  return spokenName ? escapeHtml(fillText('bot.draft_new_customer', 'name', spokenName)) : null;
}

function timingPart(draft: OrderDraft, ctx: DraftContext): string | null {
  const timing = resolveDraftTiming(draft.timing, ctx.today);
  if (!timing) return null;
  let text: string | null = null;
  if (timing.deliveryType === 'shabbat') {
    text = `${t('delivery.shabbat')} (${formatWeekdayShort(comingFriday(ctx.today))})`;
  } else if (timing.deliveryType === 'asap') {
    text = t('delivery.asap');
  } else if (timing.deliveryType === 'specific_date' && timing.deliveryDate) {
    text = formatWeekdayShort(timing.deliveryDate);
  }
  // An empty specific date has its own warning line, so nothing is said here.
  if (!text) return null;
  if (draft.recurring && timing.deliveryType !== 'asap') text += ` · ${t('bot.draft_repeat')}`;
  return escapeHtml(text);
}

function lineText(line: OrderDraft['lines'][number], ctx: DraftContext): string {
  const bread = ctx.menu.find((b) => b.id === line.breadTypeId);
  const size = line.breadSizeId != null ? bread?.enabledSizes.find((s) => s.id === line.breadSizeId) : undefined;
  const additions = line.breadAdditionIds
    .map((id) => bread?.enabledAdditions.find((a) => a.id === id)?.name)
    .filter((n): n is string => !!n);
  let label = formatStaffItemLabel(bread?.name ?? line.heard, size?.name ?? null, size?.weightGrams ?? null, additions);
  if (line.breadSizeId == null) label += ` (${t('bot.draft_size_missing')})`;
  return `${line.quantity} × ${escapeHtml(label)}`;
}

/** The summary as Telegram HTML, at most `TELEGRAM_TEXT_LIMIT` characters once parsed. */
export function formatDraftMessage(draft: OrderDraft, transcript: string, ctx: DraftContext): string {
  const parts: string[] = [];

  const head = [
    customerPart(draft, ctx),
    timingPart(draft, ctx),
    draft.delivery == null ? null : escapeHtml(t(draft.delivery ? 'bot.draft_delivery' : 'bot.draft_pickup')),
  ].filter((p): p is string => !!p);
  if (head.length) parts.push(head.join(' · '));

  if (draft.lines.length) for (const line of draft.lines) parts.push(lineText(line, ctx));
  else parts.push(escapeHtml(t('bot.draft_no_items')));

  if (draft.notes) parts.push(escapeHtml(fillText('bot.draft_note', 'notes', draft.notes)));
  for (const w of draft.warnings) parts.push(`⚠️ ${escapeHtml(draftWarningText(w))}`);

  // A draft with an unusual number of lines could pass the limit by itself:
  // the last lines go then, marked, and the form still shows them all.
  if (visibleLength(parts.join('\n')) > TELEGRAM_TEXT_LIMIT - 2) {
    while (parts.length > 1 && visibleLength(parts.join('\n')) > TELEGRAM_TEXT_LIMIT - 2) parts.pop();
    parts.push('…');
  }

  // Only the transcript is cut: the summary and the warnings matter more. It is cut
  // before escaping, so an entity is never split, and by what Telegram counts.
  const label = `${t('bot.draft_heard')}: `;
  const raw = transcript.trim();
  let message = parts.join('\n');
  if (raw) {
    const budget = TELEGRAM_TEXT_LIMIT - visibleLength(message) - 1 /* the newline */ - label.length;
    let quoted = raw;
    if (raw.length > budget) {
      quoted = raw.slice(0, Math.max(0, budget - 1));
      // Not in the middle of an emoji.
      if (/[\ud800-\udbff]$/.test(quoted)) quoted = quoted.slice(0, -1);
      quoted += '…';
    }
    if (budget > 0) message += `\n<blockquote expandable>${escapeHtml(label)}${escapeHtml(quoted)}</blockquote>`;
  }
  return message;
}
