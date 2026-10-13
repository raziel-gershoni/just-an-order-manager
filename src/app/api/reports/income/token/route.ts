import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { signExportToken } from '@/lib/export-token';
import { INCOME_REPORT_TOKEN, parseReportYear } from '@/lib/income-report';

// Mints a short-lived download URL for the income spreadsheet. Same gate as the
// report itself; the token carries the authorization, because Telegram's native
// downloadFile can't send the initData header. Bound to this report, so it
// opens nothing else — and no other link opens this.
export const GET = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager') {
    return errorResponse('Forbidden', 403);
  }
  const year = parseReportYear(new URL(request.url).searchParams.get('year'));
  if (year == null) return errorResponse('Invalid year', 400);

  const token = signExportToken(groupId, 300, INCOME_REPORT_TOKEN);
  return jsonResponse({
    url: `/api/reports/income/file?token=${token}&year=${year}`,
    fileName: `income-${year}.xlsx`,
  });
});
