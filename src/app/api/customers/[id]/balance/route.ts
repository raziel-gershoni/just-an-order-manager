import { withGroup, jsonResponse } from '@/lib/api-utils';
import { getAvailableBalance, getCustomerBalance } from '@/lib/order-payments';

export const GET = withGroup(async (request, _auth, groupId) => {
  const parts = new URL(request.url).pathname.split('/');
  const customerId = Number(parts[parts.indexOf('customers') + 1]);

  // `available` leaves out money paid ahead for orders not yet delivered: it is
  // theirs, not credit another order can be settled from.
  const [balance, available] = await Promise.all([
    getCustomerBalance(customerId, groupId),
    getAvailableBalance(customerId, groupId),
  ]);
  return jsonResponse({ balance, available });
});
