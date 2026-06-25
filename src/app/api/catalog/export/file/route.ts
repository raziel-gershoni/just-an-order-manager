import { verifyExportToken } from '@/lib/export-token';
import { buildCatalogExport } from '@/lib/catalog-export';

// Serves the pricelist JSON as a downloadable file. Authorized by a
// short-lived signed token (from /api/catalog/export/token) carried in the
// query — Telegram's native downloadFile can't send headers, and a token
// avoids stuffing (and mangling) initData in the URL.
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return new Response('Bad request', { status: 400 });

  const gid = verifyExportToken(token);
  if (!gid) return new Response('Unauthorized', { status: 401 });

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
