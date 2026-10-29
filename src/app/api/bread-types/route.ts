import { withGroup, jsonResponse } from '@/lib/api-utils';
import { loadBreadMenu } from '@/lib/bread-menu';

export const GET = withGroup(async (_request, _auth, groupId) => {
  return jsonResponse({ breadTypes: await loadBreadMenu(groupId) });
});
