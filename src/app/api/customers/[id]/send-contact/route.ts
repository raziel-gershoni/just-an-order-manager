import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers, customerPhones } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { getBot } from '@/lib/bot';

// pathname: /api/customers/<id>/send-contact
function getCustomerId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  return Number(parts[parts.length - 2]);
}

/**
 * Sends the customer as a native Telegram contact card to the requesting user's
 * chat. Tapping it in Telegram opens the device's standard "Add to Contacts"
 * sheet. A full vCard (all phones + address) is attached so the saved contact is
 * complete, not just the primary number.
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
    .select({ phone: customerPhones.phone })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, id))
    .orderBy(asc(customerPhones.sortOrder));

  if (phones.length === 0) return errorResponse('Customer has no phone numbers', 400);

  const esc = (v: string) => v.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(customer.name)}`,
    `N:${esc(customer.name)};;;;`,
    ...phones.map((p) => `TEL;TYPE=CELL:${p.phone}`),
  ];
  const addr = [customer.address, customer.city].filter(Boolean).join(', ');
  if (addr) lines.push(`ADR;TYPE=HOME:;;${esc(addr)};;;;`);
  lines.push('END:VCARD');
  const vcard = lines.join('\n').slice(0, 2048); // Telegram vcard limit

  try {
    await getBot().api.sendContact(auth.dbUser.telegramId, phones[0].phone, customer.name, { vcard });
  } catch (err) {
    console.error('[send-contact] failed:', err);
    return errorResponse('Failed to send contact', 500);
  }

  return jsonResponse({ sent: true });
});
