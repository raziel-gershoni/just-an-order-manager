import { db } from '@/db';
import { customerPhones } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';

/**
 * Clean a phone number as it comes in from a form/paste, before storing it.
 * Strips invisible marks that get baked in when a number is typed or pasted
 * into an RTL/Hebrew field — bidi-control (U+202A–202E), isolates (U+2066–2069),
 * LRM/RLM (U+200E/200F), and zero-width chars (U+200B–200D, U+FEFF) — then trims.
 * These survive String.trim() (they're format chars, not whitespace) and made
 * valid numbers fail normalization silently. Visible formatting (dashes, spaces)
 * is kept so the number still displays the way the owner typed it.
 */
export function sanitizePhoneInput(phone: string): string {
  return phone
    .replace(/[\u200B-\u200F\u2066-\u2069\u202A-\u202E\uFEFF]/g, '')
    .trim();
}

/**
 * Return all phone strings for a customer, ordered by sortOrder.
 * Returns an empty array if the customer has none.
 */
export async function getCustomerPhones(customerId: number): Promise<string[]> {
  const rows = await db
    .select({ phone: customerPhones.phone })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, customerId))
    .orderBy(asc(customerPhones.sortOrder));
  return rows.map((r) => r.phone);
}
