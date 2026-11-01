import { normalizePhoneNumber } from './phone-links';
import { outboundAllowed, logSuppressed } from './outbound';

export { normalizePhoneNumber };

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
// Meta retires each Graph API version about two years after the next one
// ships (v21.0 goes on 2027-01-21; v26.0 has no date yet). Raise it here, the
// one place the app calls Meta, after reading the WhatsApp changelog.
const GRAPH_API_VERSION = 'v26.0';

/**
 * One POST to a Graph send endpoint. A refusal comes back as { ok: false };
 * a network failure throws, since the message may have gone out anyway.
 * `messageId` is Meta's id for the message (the wamid), which its delivery
 * status webhooks name; it is null only when the answer wasn't the JSON Meta
 * documents, which doesn't turn an accepted send into a failure.
 */
async function postToMeta(
  endpoint: 'messages' | 'marketing_messages',
  body: string
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_ID}/${endpoint}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body,
    }
  );
  if (!res.ok) return { ok: false, error: await res.text() };

  let text = '';
  try {
    text = await res.text();
    const id = (JSON.parse(text) as { messages?: { id?: unknown }[] }).messages?.[0]?.id;
    if (typeof id === 'string') return { ok: true, messageId: id };
    console.warn('WhatsApp accepted the send but returned no message id:', text.slice(0, 300));
  } catch (err) {
    console.warn('WhatsApp accepted the send but the answer could not be read:', err, text.slice(0, 300));
  }
  return { ok: true, messageId: null };
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  lang: string = 'he',
  params?: string[],
  // For templates with an IMAGE header: Meta does NOT reuse the sample image
  // uploaded at template creation — the image must be supplied (as a public
  // URL) on every send.
  headerImageUrl?: string,
  // Reminders are promotional. Meta moves those to the Marketing Messages API
  // and stops taking them on /messages on 2027-10-13; order notifications are
  // utility and stay on /messages.
  opts: { marketing?: boolean } = {}
): Promise<boolean> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return false;

  // Same reason as the Telegram guard: a scratch branch isolates rows, not the
  // customer's phone.
  if (!outboundAllowed()) {
    logSuppressed(`WhatsApp template "${templateName}"`);
    return false;
  }

  const normalized = normalizePhoneNumber(to);
  if (!normalized) {
    // Was silent before — a malformed/invisible-char number just returned false
    // with no trace. JSON.stringify surfaces any hidden bidi marks in the log.
    console.error('WhatsApp send skipped — unrecognized phone number:', JSON.stringify(to));
    return false;
  }

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: lang },
  };

  const components: unknown[] = [];
  if (headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: headerImageUrl } }],
    });
  }
  if (params && params.length > 0) {
    components.push({
      type: 'body',
      parameters: params.map((text) => ({ type: 'text', text })),
    });
  }
  if (components.length > 0) {
    template.components = components;
  }

  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    to: normalized,
    type: 'template',
    template,
  });

  try {
    if (opts.marketing) {
      const mm = await postToMeta('marketing_messages', body);
      if (mm.ok) {
        console.log('WhatsApp sent (marketing_messages):', normalized, templateName, mm.messageId ?? '(no message id)');
        return true;
      }
      // Refused there, so nothing was sent: the business hasn't accepted the
      // Marketing Messages terms yet, or Meta files this template as utility
      // (134100). /messages carries it, as it always has.
      console.warn('WhatsApp marketing_messages refused, sending via messages:', normalized, templateName, mm.error);
    }

    const res = await postToMeta('messages', body);
    if (!res.ok) {
      console.error('WhatsApp send failed:', normalized, res.error);
      return false;
    }

    console.log('WhatsApp sent:', normalized, templateName, res.messageId ?? '(no message id)');
    return true;
  } catch (err) {
    console.error('WhatsApp send error:', err);
    return false;
  }
}

/** A failed media lookup or download; `status` is Meta's HTTP status, null when it never answered. */
export class WhatsAppMediaError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'WhatsAppMediaError';
  }
}

export type WhatsAppMedia =
  | { ok: true; bytes: Buffer; mimeType: string | null }
  | { ok: false; reason: 'too_big'; sizeBytes: number };

async function graphGet(url: string, what: string): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
  if (!res.ok) {
    throw new WhatsAppMediaError(`${what} HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`, res.status);
  }
  return res;
}

/**
 * A file a customer sent: media id -> { url, mime_type, file_size } -> the
 * bytes (both calls need the token). A file bigger than `maxBytes` is not
 * downloaded; Meta's own size is trusted when it gives one.
 */
export async function fetchWhatsAppMedia(mediaId: string, maxBytes: number): Promise<WhatsAppMedia> {
  if (!WHATSAPP_TOKEN) throw new WhatsAppMediaError('WHATSAPP_TOKEN is not set', null);
  const info = (await (await graphGet(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(mediaId)}`,
    'media lookup'
  )).json()) as { url?: string; mime_type?: string; file_size?: number | string };
  if (!info.url) throw new WhatsAppMediaError('media lookup returned no url', null);
  const declared = Number(info.file_size);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: 'too_big', sizeBytes: declared };
  }
  const bytes = Buffer.from(await (await graphGet(info.url, 'media download')).arrayBuffer());
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_big', sizeBytes: bytes.length };
  return { ok: true, bytes, mimeType: info.mime_type ?? null };
}
