/**
 * Meta's messages webhook, read into plain items. Pure: no database, no
 * network, so the one handler behind the route (today it forwards to Telegram,
 * later it can drive an ordering bot) never sees a raw payload.
 *
 * Since 2026 a sender may be known only by a business-scoped user ID (BSUID):
 * message.from is then absent and message.from_user_id carries it, while
 * contacts[].wa_id (the phone) is absent unless the user has not turned on a
 * username or has been in touch with this number in the last 30 days.
 */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const digitsOnly = (v: unknown): string | null => (typeof v === 'string' && /^\d+$/.test(v) ? v : null);

export type MediaKind = 'image' | 'video' | 'document' | 'voice' | 'audio' | 'sticker';

export type InboundContent =
  | { kind: 'text'; text: string }
  | { kind: 'media'; media: MediaKind; mediaId: string; mimeType: string | null; caption: string | null; filename: string | null }
  | { kind: 'location'; latitude: number; longitude: number; name: string | null; address: string | null }
  | { kind: 'contacts'; lines: { name: string; phones: string[] }[] }
  | { kind: 'reaction'; emoji: string }
  | { kind: 'reaction_removed' }
  | { kind: 'other'; type: string };

export interface InboundItem {
  /** Meta's message id (wamid): the dedupe key. */
  messageId: string;
  /** The WhatsApp business account id of the webhook entry. */
  accountId: string | null;
  sender: {
    /** Digits only, e.g. 972500000001; null when Meta hid the number. */
    phone: string | null;
    bsuid: string | null;
    name: string | null;
  };
  content: InboundContent;
}

export interface InboundStatus {
  messageId: string | null;
  status: string;
  /** Phone (recipient_id) or, when Meta hid it, the BSUID. */
  recipient: string | null;
  error: { code: number | string | null; title: string | null; message: string | null } | null;
}

function parseContent(m: Json): InboundContent {
  const type = str(m.type) ?? 'unknown';
  switch (type) {
    case 'text': {
      const body = isObject(m.text) ? str(m.text.body) : null;
      return body ? { kind: 'text', text: body } : { kind: 'other', type };
    }
    case 'image':
    case 'video':
    case 'document':
    case 'sticker':
    case 'audio': {
      const o = m[type];
      const id = isObject(o) ? str(o.id) : null;
      if (!isObject(o) || !id) return { kind: 'other', type };
      const media: MediaKind = type === 'audio' ? (o.voice === true ? 'voice' : 'audio') : type;
      return {
        kind: 'media',
        media,
        mediaId: id,
        mimeType: str(o.mime_type),
        caption: str(o.caption),
        filename: str(o.filename),
      };
    }
    case 'location': {
      const l = isObject(m.location) ? m.location : null;
      const latitude = l ? num(l.latitude) : null;
      const longitude = l ? num(l.longitude) : null;
      if (!l || latitude === null || longitude === null) return { kind: 'other', type };
      return { kind: 'location', latitude, longitude, name: str(l.name), address: str(l.address) };
    }
    case 'contacts': {
      const list = Array.isArray(m.contacts) ? m.contacts : [];
      const lines = list.filter(isObject).map((c) => {
        const name = isObject(c.name) ? (str(c.name.formatted_name) ?? str(c.name.first_name)) : null;
        const phones = (Array.isArray(c.phones) ? c.phones : [])
          .filter(isObject)
          .map((p) => str(p.phone) ?? str(p.wa_id))
          .filter((p): p is string => p !== null);
        return { name: name ?? '', phones };
      });
      return lines.length ? { kind: 'contacts', lines } : { kind: 'other', type };
    }
    case 'button': {
      // A template's quick-reply button the customer tapped.
      const text = isObject(m.button) ? (str(m.button.text) ?? str(m.button.payload)) : null;
      return text ? { kind: 'text', text } : { kind: 'other', type };
    }
    case 'interactive': {
      const i = isObject(m.interactive) ? m.interactive : null;
      const reply = i
        ? (isObject(i.button_reply) ? i.button_reply : isObject(i.list_reply) ? i.list_reply : null)
        : null;
      const nfm = i && isObject(i.nfm_reply) ? i.nfm_reply : null;
      const text = reply ? str(reply.title) : nfm ? (str(nfm.body) ?? str(nfm.name)) : null;
      return text ? { kind: 'text', text } : { kind: 'other', type };
    }
    case 'reaction': {
      const emoji = isObject(m.reaction) ? str(m.reaction.emoji) : null;
      return emoji ? { kind: 'reaction', emoji } : { kind: 'reaction_removed' };
    }
    default:
      // unsupported, order, system, request_welcome, or a type Meta added since.
      return { kind: 'other', type };
  }
}

/** Every message of one `messages` change value, in order. */
export function parseMessagesValue(value: unknown, accountId: string | null): InboundItem[] {
  if (!isObject(value) || !Array.isArray(value.messages)) return [];
  const contacts = (Array.isArray(value.contacts) ? value.contacts : []).filter(isObject);
  const items: InboundItem[] = [];
  for (const raw of value.messages) {
    if (!isObject(raw)) continue;
    const messageId = str(raw.id);
    if (!messageId) {
      console.error('[wa-webhook] message without an id skipped, type:', str(raw.type));
      continue;
    }
    const from = str(raw.from);
    const fromUserId = str(raw.from_user_id);
    const contact =
      contacts.find((c) => [from, fromUserId].some((k) => k !== null && (c.wa_id === k || c.user_id === k))) ??
      contacts[0] ??
      null;
    const phone = digitsOnly(contact?.wa_id) ?? digitsOnly(from);
    const bsuid = fromUserId ?? str(contact?.user_id) ?? (from && !digitsOnly(from) ? from : null);
    const profile = contact && isObject(contact.profile) ? contact.profile : null;
    items.push({
      messageId,
      accountId,
      sender: { phone, bsuid, name: profile ? str(profile.name) : null },
      content: parseContent(raw),
    });
  }
  return items;
}

/** Every delivery status of one `messages` change value. */
export function parseStatusesValue(value: unknown): InboundStatus[] {
  if (!isObject(value) || !Array.isArray(value.statuses)) return [];
  return value.statuses.filter(isObject).map((s) => {
    const err = Array.isArray(s.errors) ? s.errors.find(isObject) : null;
    return {
      messageId: str(s.id),
      status: str(s.status) ?? 'unknown',
      recipient: str(s.recipient_id) ?? str(s.recipient_user_id),
      error: err
        ? {
            code: typeof err.code === 'number' || typeof err.code === 'string' ? err.code : null,
            title: str(err.title),
            message: str(err.message) ?? (isObject(err.error_data) ? str(err.error_data.details) : null),
          }
        : null,
    };
  });
}

/** Webhook-level errors (value.errors[]), as plain objects for the log. */
export function parseErrorsValue(value: unknown): Json[] {
  return isObject(value) && Array.isArray(value.errors) ? value.errors.filter(isObject) : [];
}

/** Last four characters only: enough to tell numbers apart in a log, not to identify a person. */
export function last4(v: string | null | undefined): string {
  return v ? v.slice(-4) : '-';
}
