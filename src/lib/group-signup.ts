import { db } from '@/db';
import { groups } from '@/db/schema';

/**
 * Whether a new business may be set up right now. Only on an empty
 * installation: the first person to open the app becomes its owner, and from
 * then on the only way in is an invite from that business. Until 2026-11-24
 * anyone who found the bot could create a business of their own and run up the
 * paid keys (Gemini, Google Maps, famcal); nobody had.
 *
 * Shared by `POST /api/groups` (which refuses) and `GET /api/auth/me` (which
 * tells the Mini App whether to show the setup card), so the two can't drift.
 * Limit: on an empty installation two people opening the app in the same
 * instant could both pass; that window exists only on a fresh deploy.
 */
export async function canCreateGroup(): Promise<boolean> {
  const [existing] = await db.select({ id: groups.id }).from(groups).limit(1);
  return !existing;
}
