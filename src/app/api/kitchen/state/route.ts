import { NextResponse, type NextRequest } from 'next/server';
import { KITCHEN_COOKIE, screenCookie, signScreenToken, verifyScreenToken } from '@/lib/kitchen-screen';
import { getKitchenData, kitchenStamp } from '@/lib/kitchen-sheet';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// Asked every 30 s by the kitchen screen. Answered from the saved copy, so it
// never wakes the database unless something was saved since the last build.
export async function GET(request: NextRequest) {
  const token = request.cookies.get(KITCHEN_COOKIE)?.value;
  let groupId: number | null = null;
  try {
    const screen = token ? await verifyScreenToken(token) : null;
    if (!screen) {
      console.warn(token ? '[kitchen] screen cookie rejected (disconnected or not ours)' : '[kitchen] state check without a screen cookie');
      return NextResponse.json({ error: 'disconnected' }, { status: 401, headers: NO_STORE });
    }
    groupId = screen.groupId;
    const data = await getKitchenData(screen.groupId);
    const res = NextResponse.json({ stamp: kitchenStamp(data) }, { headers: NO_STORE });
    res.cookies.set(screenCookie(signScreenToken(screen.groupId, screen.version)));
    return res;
  } catch (err) {
    console.error(`[kitchen] state check failed for group ${groupId ?? 'unknown'}:`, err);
    return NextResponse.json({ error: 'unavailable' }, { status: 500, headers: NO_STORE });
  }
}
