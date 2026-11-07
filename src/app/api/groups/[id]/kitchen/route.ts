import { withGroup, jsonResponse, errorResponse, refuseUnlessManager as refuse } from '@/lib/api-utils';
import { disconnectScreens, startPairing } from '@/lib/kitchen-screen';

// Pairing and disconnecting the kitchen screen: owners and managers only, the
// same people who may print the sheet it shows.

export const POST = withGroup(async (request, auth, groupId) => {
  const refused = refuse(request, auth, groupId);
  if (refused) return refused;
  try {
    const { code, expiresAt } = await startPairing(groupId);
    console.log(`[kitchen] pairing code issued for group ${groupId}`);
    return jsonResponse({ path: `/kitchen/pair?code=${encodeURIComponent(code)}`, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error(`[kitchen] issuing a pairing code failed for group ${groupId}:`, err);
    return errorResponse('Could not start pairing', 500);
  }
});

export const DELETE = withGroup(async (request, auth, groupId) => {
  const refused = refuse(request, auth, groupId);
  if (refused) return refused;
  try {
    await disconnectScreens(groupId);
    console.log(`[kitchen] screens disconnected for group ${groupId}`);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(`[kitchen] disconnecting screens failed for group ${groupId}:`, err);
    return errorResponse('Could not disconnect', 500);
  }
});
