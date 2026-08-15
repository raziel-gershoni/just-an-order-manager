import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { signExportToken } from '@/lib/export-token';

// Mints a link to the printable packing sheet. Manager-gated here (normal
// initData auth); the token carries the authorization so the page itself needs
// none — it gets opened in a real browser, which has no initData to send and
// couldn't print from inside Telegram anyway.
//
// Half an hour rather than the download default of five minutes: printing is a
// sit-down job. You open the sheet, switch dates, fiddle with the print dialog,
// go and find paper.
const PRINT_TOKEN_TTL_SECONDS = 1800;

export const GET = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'baker' || role === 'driver') {
    return errorResponse('Forbidden', 403);
  }
  const range = new URL(request.url).searchParams.get('d') || 'today';
  const token = signExportToken(groupId, PRINT_TOKEN_TTL_SECONDS);
  return jsonResponse({
    url: `/print/orders?token=${token}&d=${encodeURIComponent(range)}`,
  });
});
