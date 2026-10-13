import { verifyExportToken } from '@/lib/export-token';
import { INCOME_REPORT_TOKEN, buildIncomeExport, parseReportYear } from '@/lib/income-report';
import { buildIncomeWorkbook } from '@/lib/income-report-xlsx';

// Serves the income spreadsheet. Authorized by a token from
// /api/reports/income/token — the group comes from the token, never the query.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response('Bad request', { status: 400 });

  const groupId = verifyExportToken(token, INCOME_REPORT_TOKEN);
  if (!groupId) return new Response('Unauthorized', { status: 401 });

  const year = parseReportYear(url.searchParams.get('year'));
  if (year == null) return new Response('Bad request', { status: 400 });

  const { report, transactions } = await buildIncomeExport(groupId, year);
  const file = await buildIncomeWorkbook(report, transactions);

  // An ASCII filename: a Hebrew one throws in the header, and Telegram's
  // file_name is ASCII on the client side too.
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="income-${year}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
