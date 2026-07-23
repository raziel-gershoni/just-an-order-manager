import { db } from '@/db';
import { customerPhones } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';

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

/**
 * The phone rows (id + number) that should receive AUTOMATIC messages for a
 * customer — i.e. `notify = true` — ordered by sortOrder. The single source of
 * truth for "which of a customer's numbers do we auto-message"; every automatic
 * sender (order confirmations, ready, cancelled, reminders, recurring) routes
 * through this. The id is kept for callers that log per-phone (reminderSends).
 * An empty result means the owner silenced all of this customer's numbers.
 */
export async function getNotifiablePhoneRows(
  customerId: number
): Promise<{ id: number; phone: string }[]> {
  return db
    .select({ id: customerPhones.id, phone: customerPhones.phone })
    .from(customerPhones)
    .where(and(eq(customerPhones.customerId, customerId), eq(customerPhones.notify, true)))
    .orderBy(asc(customerPhones.sortOrder));
}

/** Notifiable phone numbers for a customer — the string-only convenience form. */
export async function getNotifiablePhones(customerId: number): Promise<string[]> {
  const rows = await getNotifiablePhoneRows(customerId);
  return rows.map((r) => r.phone);
}
