import { brandIconResponse } from '@/lib/brand-icon';

// Apple touch icon (iOS home-screen bookmark). 180×180 is Apple's recommended
// size; reuses the same logo/branded-mark as the favicon.
export const runtime = 'nodejs';
export const revalidate = 3600;
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return brandIconResponse(size);
}
