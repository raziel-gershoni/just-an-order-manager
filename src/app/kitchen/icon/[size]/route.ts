import { brandIconResponse } from '@/lib/brand-icon';

export const runtime = 'nodejs';
export const revalidate = 3600;
const SIZES = new Set([192, 512]);

// The kitchen screen's home-screen icon. Chrome only opens an installed page
// full-screen when its manifest has a 192px and a 512px icon.
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response('Not found', { status: 404 });
  return brandIconResponse({ width: size, height: size });
}
