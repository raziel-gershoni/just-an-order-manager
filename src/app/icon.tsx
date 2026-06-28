import { brandIconResponse } from '@/lib/brand-icon';

// App favicon = the bakery's uploaded logo (single-bakery app). One dynamic
// icon (no static favicon.ico) so there's no competing <link>. 96×96 is a
// multiple of 48, per Google's search-result favicon guidance.
export const runtime = 'nodejs';
export const revalidate = 3600;
export const size = { width: 96, height: 96 };
export const contentType = 'image/png';

export default function Icon() {
  return brandIconResponse(size);
}
