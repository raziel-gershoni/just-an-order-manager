const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

/**
 * Normalize an Israeli phone number to E.164 format (without +).
 * Handles: 050-1234567, 0501234567, +972501234567, 972501234567
 */
export function normalizePhoneNumber(phone: string): string | null {
  const digits = phone.replace(/[\s\-\(\)\+]/g, '');

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
  params?: string[]
): Promise<boolean> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return false;

  const normalized = normalizePhoneNumber(to);
  if (!normalized) return false;

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: lang },
  };

  if (params && params.length > 0) {
    template.components = [
      {
        type: 'body',
        parameters: params.map((text) => ({ type: 'text', text })),
      },
    ];
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
