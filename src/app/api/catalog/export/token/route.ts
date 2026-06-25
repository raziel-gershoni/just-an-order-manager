import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { signExportToken } from '@/lib/export-token';

// Mints a short-lived download URL for the pricelist file. Manager-gated
// (normal initData header auth); the returned token carries the authorization
// so the file endpoint itself needs no initData.
export const GET = withGroup(async (_request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'baker' || role === 'driver') {
    return errorResponse('Forbidden', 403);
  }
  const token = signExportToken(groupId);
  return jsonResponse({ url: `/api/catalog/export/file?token=${token}` });
});
