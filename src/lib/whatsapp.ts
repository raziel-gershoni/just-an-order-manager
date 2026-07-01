const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

/**
 * Normalize an Israeli phone number to E.164 format (without +).
 * Handles: 050-1234567, 0501234567, +972501234567, 972501234567
 */
export function normalizePhoneNumber(phone: string): string | null {
  // Strip every non-digit: spaces, dashes, parens, +, and — crucially —
  // invisible bidi-control marks (U+202A–202E, U+200E/200F). Those get baked
  // into a number when it's typed or pasted into an RTL/Hebrew field; the old
  // character-class strip left them in place, so a valid number like
  // "‭051-2774420‬" normalized to null and the send failed silently.
  let digits = phone.replace(/\D/g, '');

  // Tolerate an international 00 prefix: 00972… → 972…
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Already in international format
  if (digits.startsWith('972') && digits.length === 12) {
    return digits;
  }

  // Israeli local format: 0XX-XXXXXXX
  if (digits.startsWith('0') && digits.length === 10) {
    return '972' + digits.slice(1);
  }

  return null;
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  lang: string = 'he',
  params?: string[],
  // For templates with an IMAGE header: Meta does NOT reuse the sample image
  // uploaded at template creation — the image must be supplied (as a public
  // URL) on every send.
  headerImageUrl?: string
): Promise<boolean> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return false;

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

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalized,
          type: 'template',
          template,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('WhatsApp send failed:', normalized, err);
      return false;
    }

    console.log('WhatsApp sent:', normalized, templateName);
    return true;
  } catch (err) {
    console.error('WhatsApp send error:', err);
    return false;
  }
}
