import { db } from '@/db';
import { customerPhones } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';

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
