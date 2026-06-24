import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { buildCatalogExport } from '@/lib/catalog-export';

// Hebrew-keyed pricelist snapshot for the active group — managers only.
export const GET = withGroup(async (_request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'baker' || role === 'driver') {
    return errorResponse('Forbidden', 403);
  }
  const data = await buildCatalogExport(groupId);
  if (!data) return errorResponse('Group not found', 404);
  return jsonResponse(data);
});
