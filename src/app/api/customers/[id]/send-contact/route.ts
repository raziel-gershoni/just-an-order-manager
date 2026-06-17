import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers, customerPhones } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { getBot } from '@/lib/bot';
import { phoneContactName } from '@/lib/name-utils';

// pathname: /api/customers/<id>/send-contact
function getCustomerId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  return Number(parts[parts.length - 2]);
}

const esc = (v: string) => v.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

/**
 * Sends customer phone numbers as native Telegram contact cards to the requesting
 * user's chat — one card PER number, each named via the number's own label +
 * the customer's inferred family name (see phoneContactName). Tapping a card opens
 * the device's standard Add-to-Contacts sheet.
 * Body: { phoneId?: number } — a specific number, or all of them when omitted.
 */
export const POST = withGroup(async (request, auth, groupId) => {
  const id = getCustomerId(request.url);

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.groupId, groupId)))
    .limit(1);
  if (!customer) return errorResponse('Customer not found', 404);

  const phones = await db
    .select({ id: customerPhones.id, phone: customerPhones.phone, name: customerPhones.name })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, id))
    .orderBy(asc(customerPhones.sortOrder));
  if (phones.length === 0) return errorResponse('Customer has no phone numbers', 400);

  const body = await request.json().catch(() => ({}));
  const phoneId = typeof body?.phoneId === 'number' ? body.phoneId : undefined;
  const targets = phoneId ? phones.filter((p) => p.id === phoneId) : phones;
  if (targets.length === 0) return errorResponse('Phone not found', 404);

  const addr = [customer.address, customer.city].filter(Boolean).join(', ');

  try {
    for (const p of targets) {
      const { firstName, lastName } = phoneContactName(customer.name, p.name);
      const fn = [firstName, lastName].filter(Boolean).join(' ');
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${esc(fn)}`,
        `N:${esc(lastName)};${esc(firstName)};;;`,
        `TEL;TYPE=CELL:${p.phone}`,
      ];
      if (addr) lines.push(`ADR;TYPE=HOME:;;${esc(addr)};;;;`);
      lines.push('END:VCARD');
      const vcard = lines.join('\n').slice(0, 2048);
      await getBot().api.sendContact(auth.dbUser.telegramId, p.phone, firstName, {
        ...(lastName ? { last_name: lastName } : {}),
        vcard,
      });
    }
  } catch (err) {
    console.error('[send-contact] failed:', err);
    return errorResponse('Failed to send contact', 500);
  }

  return jsonResponse({ sent: targets.length });
});
