import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { reminderSends, customers, customerPhones, reminderTemplates } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';

const OCCASIONS = ['week_start', 'shabbat', 'recurring'] as const;
const STATUSES = ['sent', 'failed'] as const;
type Occasion = (typeof OCCASIONS)[number];
type Status = (typeof STATUSES)[number];

// Read-only send history (the reminder_sends audit log), newest first, with the
// customer name / phone / template label joined in. Owner/manager only.
export const GET = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker' || membership?.role === 'driver') {
    return errorResponse('Bakers cannot view reminder history', 403);
  }

  const url = new URL(request.url);
  const occasionParam = url.searchParams.get('occasion');
  const statusParam = url.searchParams.get('status');
  const occasion = OCCASIONS.includes(occasionParam as Occasion) ? (occasionParam as Occasion) : null;
  const status = STATUSES.includes(statusParam as Status) ? (statusParam as Status) : null;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  const conds = [eq(reminderSends.groupId, groupId)];
  if (occasion) conds.push(eq(reminderSends.occasion, occasion));
  if (status) conds.push(eq(reminderSends.status, status));

  // Fetch one extra row to tell whether there's another page.
  const rows = await db
    .select({
      id: reminderSends.id,
      customerId: reminderSends.customerId,
      customerName: customers.name,
      phone: customerPhones.phone,
      templateLabel: reminderTemplates.label,
      occasion: reminderSends.occasion,
      status: reminderSends.status,
      sentAt: reminderSends.sentAt,
    })
    .from(reminderSends)
    .innerJoin(customers, eq(reminderSends.customerId, customers.id))
    .leftJoin(customerPhones, eq(reminderSends.phoneId, customerPhones.id))
    .leftJoin(reminderTemplates, eq(reminderSends.templateId, reminderTemplates.id))
    .where(and(...conds))
    // Secondary id sort so ties on sentAt (a burst of sends share now()) order
    // deterministically across pages — otherwise offset pages could dup/skip.
    .orderBy(desc(reminderSends.sentAt), desc(reminderSends.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return jsonResponse({ sends: hasMore ? rows.slice(0, limit) : rows, hasMore });
});
