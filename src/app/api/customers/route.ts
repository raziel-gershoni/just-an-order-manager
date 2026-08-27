import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers, customerPhones } from '@/db/schema';
import { eq, and, asc, inArray, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { sanitizePhoneInput } from '@/lib/customer-phones';
import { todayStr } from '@/lib/date-utils';
import { temperatureOf, type OrderRhythm } from '@/lib/customer-temperature';

export const GET = withGroup(async (request, auth, groupId) => {
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') !== 'false';

  const conditions = [eq(customers.groupId, groupId)];
  if (activeOnly) conditions.push(eq(customers.isActive, true));

  const rows = await db
    .select()
    .from(customers)
    .where(and(...conditions))
    .orderBy(asc(customers.name));

  const customerIds = rows.map((c) => c.id);
  const today = todayStr();

  // Phones and ordering rhythm, fanned in together. Independent queries, and
  // neon-http pays a round trip for each, so they go in parallel rather than
  // the two sequential awaits this route used to do.
  const [phones, rhythms] = await Promise.all([
    customerIds.length
      ? db
          .select()
          .from(customerPhones)
          .where(inArray(customerPhones.customerId, customerIds))
          .orderBy(asc(customerPhones.sortOrder))
      : Promise.resolve([]),
    customerIds.length ? loadRhythms(groupId, customerIds, today) : Promise.resolve(new Map()),
  ]);

  // name and notify travel with the number: the list's WhatsApp picker labels
  // each one and marks the silenced ones, and both live on this row.
  const phonesByCustomer: Record<
    number,
    { id: number; phone: string; sortOrder: number; name: string | null; notify: boolean }[]
  > = {};
  for (const p of phones) {
    if (!phonesByCustomer[p.customerId]) phonesByCustomer[p.customerId] = [];
    phonesByCustomer[p.customerId].push({
      id: p.id,
      phone: p.phone,
      sortOrder: p.sortOrder,
      name: p.name,
      notify: p.notify,
    });
  }

  const result = rows.map((c) => ({
    ...c,
    phones: phonesByCustomer[c.id] ?? [],
    // Computed here rather than on the client: it is fixed for the life of the
    // page, and "today" has to mean one thing across the SQL and the scoring.
    temperature: temperatureOf(
      rhythms.get(c.id) ?? { pastOrders: 0, lastOrder: null, nextOrder: null, medianGap: null },
      today
    ),
  }));

  // The caller's own id travels with the list so the client can sort its own
  // customers first without a second round trip to /auth/me.
  return jsonResponse({ customers: result, meId: auth.dbUser.id });
});

/**
 * One grouped pass over the group's orders: how many each customer has taken,
 * when the last one landed, whether another is already booked, and the median
 * gap between consecutive orders.
 *
 * Past and future are separate aggregates on purpose. A bare max(delivery_date)
 * is wrong in both directions here — a recurring customer always has a
 * future-dated clone, which would read as "ordered tomorrow", and a brand new
 * customer whose first order has not arrived yet has no past order at all.
 *
 * Raw SQL because percentile_cont(…) WITHIN GROUP has no query-builder form.
 */
async function loadRhythms(
  groupId: number,
  customerIds: number[],
  today: string
): Promise<Map<number, OrderRhythm>> {
  const ids = sql.join(
    customerIds.map((id) => sql`${id}`),
    sql`, `
  );
  const res = await db.execute(sql`
    with d as (
      select o.customer_id,
             o.delivery_date::text as dd,
             (o.delivery_date - lag(o.delivery_date)
               over (partition by o.customer_id order by o.delivery_date))::int as gap
      from orders o
      where o.group_id = ${groupId}
        and o.order_status <> 'cancelled'
        and o.delivery_date is not null
        and o.customer_id in (${ids})
    )
    select customer_id,
           count(*) filter (where dd <= ${today})::int as past_orders,
           max(dd) filter (where dd <= ${today}) as last_order,
           min(dd) filter (where dd >  ${today}) as next_order,
           percentile_cont(0.5) within group (order by gap)::float8 as median_gap
    from d
    group by customer_id
  `);

  const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  const byCustomer = new Map<number, OrderRhythm>();
  for (const row of rows) {
    byCustomer.set(Number(row.customer_id), {
      pastOrders: Number(row.past_orders),
      lastOrder: (row.last_order as string | null) ?? null,
      nextOrder: (row.next_order as string | null) ?? null,
      medianGap: row.median_gap == null ? null : Number(row.median_gap),
    });
  }
  return byCustomer;
}

const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),  // single starter phone for convenience
  address: z.string().max(500).optional(),
  city: z.string().max(255).optional(),
  telegramChatId: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
  deliveryNotes: z.string().max(1000).optional(),
});

export const POST = withGroup(async (request, auth, groupId) => {
  const body = await request.json();
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { phone, ...customerData } = parsed.data;

  // Whoever adds a customer works with them. Taken from the signed-in user
  // rather than asked for: both add forms are a single name field — the order
  // form's inline one has no room for a second — and an attribution nobody has
  // to fill in is one that stays accurate. Reassign from the customers list.
  const [customer] = await db
    .insert(customers)
    .values({ ...customerData, groupId, handlerUserId: auth.dbUser.id })
    .returning();

  // If a phone was provided at creation time, insert it as the first phone
  const cleanPhone = phone ? sanitizePhoneInput(phone) : '';
  if (cleanPhone) {
    await db.insert(customerPhones).values({
      customerId: customer.id,
      phone: cleanPhone,
      sortOrder: 0,
    });
  }

  return jsonResponse({ customer: { ...customer, phones: cleanPhone ? [{ phone: cleanPhone }] : [] } }, 201);
});
