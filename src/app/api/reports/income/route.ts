import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { buildIncomeReport, parseReportYear } from '@/lib/income-report';

// The year's money, units and customers for the דוחות screen. Every customer's
// balance and the bakery's turnover, so owners and managers only — an
// allow-list, so a role added later starts out shut out.
export const GET = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager') {
    return errorResponse('Forbidden', 403);
  }
  const year = parseReportYear(new URL(request.url).searchParams.get('year'));
  if (year == null) return errorResponse('Invalid year', 400);

  return jsonResponse(await buildIncomeReport(groupId, year));
});
