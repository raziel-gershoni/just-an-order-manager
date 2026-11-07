import { z } from 'zod/v4';
import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import type { AuthContext } from '@/lib/telegram-auth';
import { COMMUNITIES, FamcalError } from '@/lib/famcal';
import { famcalCity } from '@/lib/famcal-cities';
import { saveShabbatSetting, shabbatSettings } from '@/lib/shabbat-times';

// The kitchen screen's Shabbat mode setting: owners and managers only, the same
// people who pair the screen. A PUT fetches famcal's times first and writes
// nothing when that fails, so a failed save leaves the old setting in place.
function refuse(request: Request, auth: AuthContext, groupId: number): Response | null {
  const pathId = Number(new URL(request.url).pathname.split('/').at(-2));
  if (pathId !== groupId) return errorResponse('Group mismatch', 400);
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager') return errorResponse('Forbidden', 403);
  return null;
}

const bodySchema = z.object({ city: z.string().max(64).nullable(), community: z.enum(COMMUNITIES) });

export const GET = withGroup(async (request, auth, groupId) => {
  const refused = refuse(request, auth, groupId);
  if (refused) return refused;
  try {
    return jsonResponse(await shabbatSettings(groupId));
  } catch (err) {
    console.error(`[shabbat] loading the setting failed for group ${groupId}:`, err);
    return errorResponse('Could not load', 500);
  }
});

export const PUT = withGroup(async (request, auth, groupId) => {
  const refused = refuse(request, auth, groupId);
  if (refused) return refused;
  const parsed = bodySchema.safeParse(await request.json().catch((err) => {
    console.warn(`[shabbat] unreadable body for group ${groupId}:`, err instanceof Error ? err.message : err);
    return null;
  }));
  if (!parsed.success) return errorResponse('Invalid body', 400);
  const { city, community } = parsed.data;
  if (city !== null && !famcalCity(city)) return errorResponse('Unknown city', 400);
  try {
    await saveShabbatSetting(groupId, city, community);
  } catch (err) {
    if (err instanceof FamcalError && err.code === 'NO_KEY') {
      console.error(`[shabbat] save refused for group ${groupId}: FAMCAL_API_KEY is not set`);
      return errorResponse('famcal_no_key', 503);
    }
    if (err instanceof FamcalError) {
      console.error(`[shabbat] save for group ${groupId} failed: famcal ${err.status ?? '-'} ${err.code}`);
      return errorResponse('famcal_failed', 502);
    }
    console.error(`[shabbat] save failed for group ${groupId}:`, err);
    return errorResponse('Could not save', 500);
  }
  try {
    return jsonResponse(await shabbatSettings(groupId));
  } catch (err) {
    console.error(`[shabbat] loading the setting after a save failed for group ${groupId}:`, err);
    return errorResponse('Could not load', 500);
  }
});
