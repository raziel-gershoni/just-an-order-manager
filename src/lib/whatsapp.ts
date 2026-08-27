import { normalizePhoneNumber } from './phone-links';

export { normalizePhoneNumber };

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;


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
