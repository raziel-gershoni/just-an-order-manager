import { withGroup, jsonResponse } from '@/lib/api-utils';
import { getCustomerBalance } from '@/lib/order-payments';

export const GET = withGroup(async (request, _auth, groupId) => {
  const parts = new URL(request.url).pathname.split('/');
  const customerId = Number(parts[parts.indexOf('customers') + 1]);

  const balance = await getCustomerBalance(customerId, groupId);
  return jsonResponse({ balance });
});
