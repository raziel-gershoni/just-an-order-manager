import { NextResponse, type NextRequest } from 'next/server';
import { claimPairing, screenCookie, signScreenToken } from '@/lib/kitchen-screen';

// The pairing link opens a page with a button that posts here. Only this POST
// spends the code, so a chat app fetching the link for a preview can't use it
// up before the phone does.
export async function POST(request: NextRequest) {
  const code = String((await request.formData()).get('code') ?? '');
  const claimed = await claimPairing(code);
  if (!claimed) {
    console.warn('[kitchen] pairing code expired, already used, or wrong');
    return NextResponse.redirect(new URL('/kitchen/pair?error=expired', request.url), 303);
  }
  console.log(`[kitchen] screen paired for group ${claimed.groupId}`);
  const res = NextResponse.redirect(new URL('/kitchen', request.url), 303);
  res.cookies.set(screenCookie(signScreenToken(claimed.groupId, claimed.version)));
  return res;
}
