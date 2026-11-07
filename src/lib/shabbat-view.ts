/**
 * The kitchen screen's Shabbat mode, as the screen sees it: the stored
 * stretches (built from famcal by src/lib/shabbat-build.ts) and
 * what to show at a given instant. Client-safe: no imports, so the kitchen
 * screen's bundle never pulls in the database or famcal's client.
 */

export type ShabbatGreeting = 'shabbat' | 'chag' | 'shabbat_chag' | 'yom_kippur';

/** One prayer time on the screen. `at` is a UTC ISO instant. */
export interface ShabbatRow {
  key: string;
  name: string;
  at: string;
}

/** One rest day of a stretch. */
export interface ShabbatDay {
  /** yyyy-MM-dd at the bakery. */
  date: string;
  /** Gematriya, e.g. ג׳ תמוז תשפ״ו; famcal's text. */
  hebrewDate: string;
  /** The day's holiday or parasha title, or null. */
  occasion: string | null;
  /** That day's SHKIA as a UTC ISO instant; the screen moves to the next day after it. Null when famcal had none. */
  sunset: string | null;
}

/** One Shabbat or Yom Tov stretch, from the eve to its end. */
export interface ShabbatBlock {
  /** The eve's date and the last rest day's date, yyyy-MM-dd. */
  eve: string;
  last: string;
  /** The eve's candle lighting, a UTC ISO instant: the Shabbat view turns on. */
  start: string;
  /** The stretch's end (צאת השבת / צאת החג), a UTC ISO instant: the orders come back. */
  end: string;
  /** famcal's Hebrew name for the end. */
  endName: string;
  greeting: ShabbatGreeting;
  days: ShabbatDay[];
  /** The prayer times after `start`, through the last day, in time order. */
  rows: ShabbatRow[];
}

export interface ShabbatCredit {
  source: string;
  text: string;
  url?: string;
}

/** What shabbat_times.data holds: one fetch's result. `through` is the last eve it covered. */
export interface StoredShabbatTimes {
  city: string;
  community: string;
  through: string;
  fetchedAt: string;
  credits: ShabbatCredit[];
  blocks: ShabbatBlock[];
}

/** The part of the stored times that rides in the kitchen screen's data. */
export interface KitchenShabbat {
  blocks: ShabbatBlock[];
  credits: ShabbatCredit[];
}

export const NEXT_ROWS = 4;
const MIN_WAIT_MS = 1_000;
const MAX_WAIT_MS = 60_000;
const at = (iso: string): number => Date.parse(iso);

export interface ShabbatView {
  block: ShabbatBlock;
  day: ShabbatDay;
  upcoming: ShabbatRow[];
}

/** The stretch under way at `now`: from candle lighting (included) to the end (not included). */
export function activeBlock(blocks: ShabbatBlock[], now: number): ShabbatBlock | null {
  return blocks.find((b) => at(b.start) <= now && now < at(b.end)) ?? null;
}

/**
 * What the screen shows at `now`, or null when no stretch is under way. The day
 * (Hebrew date, occasion) is the first rest day whose sunset is still ahead,
 * else the last one; the list is the next NEXT_ROWS times of the whole stretch,
 * so the second night's candle lighting stays listed after the first day's sunset.
 */
export function shabbatViewAt(blocks: ShabbatBlock[], now: number): ShabbatView | null {
  const block = activeBlock(blocks, now);
  if (!block || block.days.length === 0) return null;
  const day = block.days.find((d) => d.sunset !== null && at(d.sunset) > now) ?? block.days[block.days.length - 1];
  const upcoming = block.rows.filter((r) => at(r.at) > now).slice(0, NEXT_ROWS);
  return { block, day, upcoming };
}

/** How long until the screen should look again: the next start, end, sunset or listed time, and at least once a minute. */
export function nextChangeIn(blocks: ShabbatBlock[], now: number): number {
  let next = now + MAX_WAIT_MS;
  for (const b of blocks) {
    for (const iso of [b.start, b.end, ...b.days.map((d) => d.sunset), ...b.rows.map((r) => r.at)]) {
      if (iso === null) continue;
      const t = at(iso);
      if (t > now && t < next) next = t;
    }
  }
  return Math.max(MIN_WAIT_MS, next - now);
}
