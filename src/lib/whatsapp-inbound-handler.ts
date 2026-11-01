import { db } from '@/db';
import { whatsappInbound } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { findCustomersByPhone } from './customer-phones';
import { publicGroupId } from './public-site';
import { fetchWhatsAppMedia, WhatsAppMediaError } from './whatsapp';
import { notifyWhatsAppMessage, type ForwardedFile, type WhatsAppForwardTarget } from './notifications';
import { last4, type InboundItem } from './whatsapp-inbound';

// Telegram bots can upload files up to 50 MB.
const TG_MAX_FILE_BYTES = 50 * 1000 * 1000;

/**
 * True when this call is the first to see the message. Meta re-sends a webhook
 * until it gets a 200, so a message can arrive again after it was forwarded.
 */
async function claimMessage(messageId: string): Promise<boolean> {
  const rows = await db
    .insert(whatsappInbound)
    .values({ messageId })
    .onConflictDoNothing()
    .returning({ messageId: whatsappInbound.messageId });
  return rows.length > 0;
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
 * in the 4xx range (the media expired, was deleted) won't change on a retry:
 * the message is forwarded with a note instead. Anything else throws, so the
 * route answers 500 and Meta sends the message again.
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
    const permanent =
      err instanceof WhatsAppMediaError && err.status !== null && err.status >= 400 && err.status < 500 && err.status !== 429;
    if (!permanent) throw err;
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

  if (!(await claimMessage(item.messageId))) {
    console.info('[wa-webhook] already forwarded, skipped', log);
    return;
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
        return;
      }
      targets.push({ groupId, customers: [] });
    }

    const file = await loadFile(item);
    const { sent, failed } = await notifyWhatsAppMessage(targets, { sender, content, file });
    console.info('[wa-webhook] forwarded', { ...log, type: content.kind, groups: targets.length, matched: customers.length, sent, failed });
  } catch (err) {
    await releaseClaim(item.messageId);
    throw err;
  }
}
