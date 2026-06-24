import { authenticateWithInitData } from '@/lib/telegram-auth';
import { buildCatalogExport } from '@/lib/catalog-export';

// Serves the pricelist JSON as a downloadable file. Auth comes from the
// initData in the query (`tgData`) since Telegram's native downloadFile
// can't send the `tma` Authorization header. Same validation (incl. the 1h
// freshness window) as a normal request.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tgData = url.searchParams.get('tgData');
  const gid = Number(url.searchParams.get('gid'));
  if (!tgData || !Number.isInteger(gid) || gid <= 0) {
    return new Response('Bad request', { status: 400 });
  }

  let auth;
  try {
    auth = await authenticateWithInitData(tgData);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const role = auth.memberships.find((m) => m.groupId === gid)?.role;
  if (!role || role === 'baker' || role === 'driver') {
    return new Response('Forbidden', { status: 403 });
  }

  const data = await buildCatalogExport(gid);
  if (!data) return new Response('Not found', { status: 404 });

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pricelist.json"',
      'Cache-Control': 'no-store',
    },
  });
}
