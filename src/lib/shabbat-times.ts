import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { groups, shabbatTimes } from '@/db/schema';
import { addDaysStr, todayStr } from './date-utils';
import { fetchDay, fetchShabbat, isCommunity, type Community } from './famcal';
import { matchFamcalCity } from './famcal-cities';
import { blocksAhead, buildShabbatTimes, coverageGap, daysOfBlock, HORIZON_DAYS } from './shabbat-build';
import type { KitchenShabbat, ShabbatCredit, StoredShabbatTimes } from './shabbat-view';

/**
 * The kitchen screen's Shabbat mode, server side. The owner's setting is a
 * famcal city and community on the groups row; the times themselves are one
 * fetch of the next HORIZON_DAYS days, built into stretches
 * (src/lib/shabbat-build.ts) and kept in shabbat_times. Saving the setting
 * fetches first and writes only on success; the morning cron refreshes with a
 * write that lands only if the setting is still the one it fetched for. The
 * reader uses the stored times only while their city and community match the
 * groups row, so a changed setting can never show another city's times.
 */

/** One fetch: /shabbat for the horizon, then /day for every day of every stretch. Any failure rejects the whole fetch. */
export async function fetchShabbatTimes(city: string, community: Community, today: string, now: Date = new Date()): Promise<StoredShabbatTimes> {
  const to = addDaysStr(today, HORIZON_DAYS);
  const shabbat = await fetchShabbat(city, community, today, to);
  const dates = [...new Set(shabbat.blocks.flatMap((b) => daysOfBlock(b.eve, b.last)))];
  const answers = await Promise.all(dates.map((d) => fetchDay(city, community, d)));
  return buildShabbatTimes({
    city,
    community,
    through: to,
    fetchedAt: now.toISOString(),
    shabbat,
    days: new Map(dates.map((d, i) => [d, answers[i]])),
  });
}

/** The stored times, only when they match the groups row's city and community. */
export async function readShabbatTimes(groupId: number): Promise<StoredShabbatTimes | null> {
  const [row] = await db
    .select({ city: groups.shabbatCity, community: groups.shabbatCommunity, data: shabbatTimes.data })
    .from(groups)
    .leftJoin(shabbatTimes, eq(shabbatTimes.groupId, groups.id))
    .where(eq(groups.id, groupId));
  if (!row || !row.city || !row.data) return null;
  if (row.data.city !== row.city || row.data.community !== row.community) {
    console.warn(`[shabbat] group ${groupId}: the stored times are for another city or community; not shown`);
    return null;
  }
  return row.data;
}

/** Turns the mode on, or changes city or community, or (city null) turns it off. Fetches first: a famcal failure throws FamcalError and nothing is written. */
export async function saveShabbatSetting(groupId: number, city: string | null, community: Community, today: string = todayStr()): Promise<void> {
  // Each path is one statement, so the times and the setting can never part: a
  // failure leaves both as they were, and a refresh racing this save either
  // lands first and is overwritten, or finds the new setting and writes nothing.
  if (city === null) {
    await db.execute(sql`
      with cleared as (delete from shabbat_times where group_id = ${groupId})
      update groups set shabbat_city = null, shabbat_community = ${community} where id = ${groupId}`);
    console.log(`[shabbat] mode turned off for group ${groupId}`);
    return;
  }
  const data = await fetchShabbatTimes(city, community, today);
  await db.execute(sql`
    with saved as (
      insert into shabbat_times (group_id, data, updated_at)
      values (${groupId}, ${JSON.stringify(data)}::jsonb, now())
      on conflict (group_id) do update set data = excluded.data, updated_at = excluded.updated_at
    )
    update groups set shabbat_city = ${city}, shabbat_community = ${community} where id = ${groupId}`);
  console.log(`[shabbat] group ${groupId} set to ${city}/${community}: ${data.blocks.length} stretches through ${data.through}`);
}

export type RefreshResult = 'off' | 'refreshed' | 'changed' | 'failed';

/** The morning refresh. A failure keeps the stored times; the write lands only if the setting is still what was fetched. */
export async function refreshShabbatTimes(groupId: number, today: string = todayStr()): Promise<RefreshResult> {
  const [g] = await db.select({ city: groups.shabbatCity, community: groups.shabbatCommunity }).from(groups).where(eq(groups.id, groupId));
  if (!g?.city) return 'off';
  const city = g.city;
  const community = isCommunity(g.community) ? g.community : 'sephardi';
  let data: StoredShabbatTimes;
  try {
    data = await fetchShabbatTimes(city, community, today);
  } catch (err) {
    console.error(`[shabbat] refreshing the times failed for group ${groupId}; the stored ones stay:`, err);
    return 'failed';
  }
  // Lands only while the setting is still the one fetched for: the select finds
  // no row once it changed, and the update's own check reads the stored row as
  // it is when the write happens, so a save committed meanwhile is never overwritten.
  const res = await db.execute(sql`
    insert into shabbat_times (group_id, data, updated_at)
    select ${groupId}, ${JSON.stringify(data)}::jsonb, now()
    from groups where id = ${groupId} and shabbat_city = ${city} and shabbat_community = ${community}
    on conflict (group_id) do update set data = excluded.data, updated_at = excluded.updated_at
      where shabbat_times.data->>'city' = ${city} and shabbat_times.data->>'community' = ${community}
    returning group_id`);
  const rows = (res as unknown as { rows?: unknown[] }).rows ?? [];
  if (rows.length === 0) {
    console.warn(`[shabbat] group ${groupId} changed its Shabbat setting during the refresh; the new setting's times stay`);
    return 'changed';
  }
  return 'refreshed';
}

/** Null when the stored times reach far enough ahead, and also when the mode is off. */
export async function shabbatCoverageGap(groupId: number, today: string): Promise<{ through: string | null } | null> {
  const [g] = await db.select({ city: groups.shabbatCity }).from(groups).where(eq(groups.id, groupId));
  if (!g?.city) return null;
  return coverageGap(await readShabbatTimes(groupId), today);
}

export interface ShabbatPreview {
  start: string;
  end: string;
  endName: string;
  occasion: string | null;
}
export interface ShabbatSettings {
  city: string | null;
  community: Community;
  homeCity: string | null;
  suggestedCity: string | null;
  next: ShabbatPreview | null;
  credits: ShabbatCredit[];
}

/** What the settings card shows. */
export async function shabbatSettings(groupId: number, now: Date = new Date()): Promise<ShabbatSettings> {
  const [g] = await db
    .select({ city: groups.shabbatCity, community: groups.shabbatCommunity, homeCity: groups.deliveryHomeCity })
    .from(groups)
    .where(eq(groups.id, groupId));
  const times = await readShabbatTimes(groupId);
  let community: Community = 'sephardi';
  if (isCommunity(g?.community)) community = g.community;
  else console.warn(`[shabbat] group ${groupId} has an unknown community "${g?.community}"; showing sephardi`);
  const block = times?.blocks.find((b) => Date.parse(b.end) > now.getTime());
  return {
    city: g?.city ?? null,
    community,
    homeCity: g?.homeCity ?? null,
    suggestedCity: matchFamcalCity(g?.homeCity)?.slug ?? null,
    next: block ? { start: block.start, end: block.end, endName: block.endName, occasion: block.days[0]?.occasion ?? null } : null,
    credits: times?.credits ?? [],
  };
}

/** The part of the stored times the kitchen copy carries. */
export function kitchenShabbat(times: StoredShabbatTimes | null, today: string): KitchenShabbat | null {
  if (!times) return null;
  const blocks = blocksAhead(times.blocks, today);
  return blocks.length === 0 ? null : { blocks, credits: times.credits };
}
