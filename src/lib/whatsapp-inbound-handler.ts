import { db } from '@/db';
import { whatsappInbound } from '@/db/schema';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { findCustomersByPhone } from './customer-phones';
import { publicGroupId } from './public-site';
import { fetchWhatsAppMedia, isRetryableMediaError, WhatsAppMediaError } from './whatsapp';
import { BYTES_PER_MB, notifyWhatsAppMessage, type ForwardedFile, type WhatsAppForwardTarget } from './notifications';
import { last4, type InboundItem } from './whatsapp-inbound';

// Telegram bots can upload files up to 50 MB (counted in MB, as the note to the owner is).
const TG_MAX_FILE_BYTES = 50 * BYTES_PER_MB;

// An attempt gets 300 s (the route's maxDuration); one unfinished for longer than
// that is dead and a repeat delivery takes it over.
const STALE_CLAIM = sql`now() - interval '6 minutes'`;

type Claim = 'claimed' | 'done' | 'in_progress';

/**
 * Meta re-sends a webhook until it gets a 200, so a message can arrive again:
 * after it was forwarded ('done'), while the first attempt is still working on
 * it ('in_progress': the caller must NOT answer 200, that attempt may yet
 * fail), or after the first attempt died without finishing (taken over).
 */
async function claimMessage(messageId: string): Promise<Claim> {
  const inserted = await db
    .insert(whatsappInbound)
    .values({ messageId })
    .onConflictDoNothing()
    .returning({ messageId: whatsappInbound.messageId });
  if (inserted.length > 0) return 'claimed';

  const takenOver = await db
    .update(whatsappInbound)
    .set({ createdAt: sql`now()` })
    .where(
      and(
        eq(whatsappInbound.messageId, messageId),
        isNull(whatsappInbound.forwardedAt),
        lt(whatsappInbound.createdAt, STALE_CLAIM)
      )
    )
    .returning({ messageId: whatsappInbound.messageId });
  if (takenOver.length > 0) {
    console.warn(`[wa-webhook] ${messageId}: an earlier attempt never finished, forwarding it now`);
    return 'claimed';
  }

  const [row] = await db
    .select({ forwardedAt: whatsappInbound.forwardedAt })
    .from(whatsappInbound)
    .where(eq(whatsappInbound.messageId, messageId));
  // No row: the other attempt failed and released it just now; Meta's next retry gets it.
  return row?.forwardedAt ? 'done' : 'in_progress';
}

/** The message is dealt with: a repeat delivery is skipped from now on. */
async function markForwarded(messageId: string): Promise<void> {
  try {
    await db.update(whatsappInbound).set({ forwardedAt: sql`now()` }).where(eq(whatsappInbound.messageId, messageId));
  } catch (err) {
    // The message did go out, so this must not fail the request (a retry would send it twice).
    console.error(`[wa-webhook] could not mark ${messageId} as forwarded, a late retry may send it again:`, err);
  }
}

async function releaseClaim(messageId: string): Promise<void> {
  try {
    await db.delete(whatsappInbound).where(eq(whatsappInbound.messageId, messageId));
  } catch (err) {
    // The retry will then be skipped as a duplicate: say so loudly.
    console.error(`[wa-webhook] could not release the claim on ${messageId}, a retry will skip it:`, err);
  }
}

/**
 * The file a message carries, fetched once for every recipient. A Meta answer
 * that won't change on a retry (the media expired or was deleted) forwards the
 * message with a note instead. Anything a retry can fix (Meta down, rate
 * limited, a rejected token) throws, so the route answers 500 and Meta sends
 * the message again once it is fixed.
 */
async function loadFile(item: InboundItem): Promise<ForwardedFile | null> {
  if (item.content.kind !== 'media') return null;
  try {
    const media = await fetchWhatsAppMedia(item.content.mediaId, TG_MAX_FILE_BYTES);
    if (media.ok) return { state: 'ready', bytes: media.bytes, mimeType: media.mimeType };
    console.warn(
      `[wa-webhook] ${item.messageId}: ${item.content.media} is ${media.sizeBytes} bytes, too big to forward`
    );
    return { state: 'too_big', sizeBytes: media.sizeBytes };
  } catch (err) {
    if (!(err instanceof WhatsAppMediaError) || isRetryableMediaError(err)) throw err;
    console.error(`[wa-webhook] ${item.messageId}: the ${item.content.media} cannot be fetched, forwarding without it:`, err);
    return { state: 'unavailable' };
  }
}

/**
 * The one handler behind the WhatsApp webhook: today it forwards the message to
 * the owner and managers on Telegram; the interactive ordering bot will branch
 * from here. Throws when the message could not be handled and a retry might
 * help; the route then answers 500.
 */
export async function handleInboundMessage(item: InboundItem): Promise<void> {
  const { content, sender } = item;
  const log = { messageId: item.messageId, account: item.accountId, from: last4(sender.phone ?? sender.bsuid) };

  if (content.kind === 'reaction_removed') {
    console.info('[wa-webhook] reaction removed, nothing to forward', log);
    return;
  }
  if (content.kind === 'other') {
    console.info(`[wa-webhook] message of type "${content.type}" can't be shown, forwarding a notice`, log);
  }

  const claim = await claimMessage(item.messageId);
  if (claim === 'done') {
    console.info('[wa-webhook] already forwarded, skipped', log);
    return;
  }
  if (claim === 'in_progress') {
    throw new Error(`[wa-webhook] ${item.messageId} is still being forwarded by an earlier delivery, asking Meta to retry`);
  }

  try {
    const customers = sender.phone ? await findCustomersByPhone(sender.phone) : [];
    const targets: WhatsAppForwardTarget[] = [];
    for (const c of customers) {
      let target = targets.find((t) => t.groupId === c.groupId);
      if (!target) targets.push((target = { groupId: c.groupId, customers: [] }));
      target.customers.push({ id: c.id, name: c.name });
    }
    if (targets.length === 0) {
      const groupId = publicGroupId();
      if (!groupId) {
        // A retry can't help: nothing here knows whom to tell.
        console.error('[wa-webhook] no matching customer and PUBLIC_SITE_GROUP_ID is not set, message not forwarded', log);
        await markForwarded(item.messageId);
        return;
      }
      targets.push({ groupId, customers: [] });
    }

    const file = await loadFile(item);
    const { sent, failed } = await notifyWhatsAppMessage(targets, { sender, content, file });
    console.info('[wa-webhook] forwarded', { ...log, type: content.kind, groups: targets.length, matched: customers.length, sent, failed });
    await markForwarded(item.messageId);
  } catch (err) {
    await releaseClaim(item.messageId);
    throw err;
  }
}
