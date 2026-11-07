import { addDaysStr, weekdayIndex } from './date-utils';
import type { DayAnswer, FamcalHoliday, ShabbatAnswer } from './famcal';
import type { ShabbatBlock, ShabbatCredit, ShabbatGreeting, StoredShabbatTimes } from './shabbat-view';

/**
 * famcal's answers made into what the kitchen screen keeps: one entry per
 * Shabbat or Yom Tov stretch with its candle lighting (the mode turns on),
 * its end (it turns off), the greeting, each rest day's Hebrew date and
 * occasion, and the prayer times shown on the screen. Pure: famcal is called
 * by src/lib/shabbat-times.ts, which hands the answers here.
 */

export const HORIZON_DAYS = 35; // how far ahead one fetch reaches
export const SCREEN_DAYS = 8; // how far ahead the kitchen copy carries stretches
export const WARN_DAYS = 8; // warn when the stored times reach less far than this

/**
 * The famcal rows the screen lists, by key (famcal's names carry the opinion).
 * Left out on purpose: dawn, misheyakir, mincha ketana, the nightfalls,
 * midnight and the end rows; the end has its own place on the screen.
 */
export const SHOWN_ROW_KEYS: readonly string[] = [
  'NETZ', 'SOF_SHMA_MGA', 'SOF_SHMA_GRA', 'SOF_TFILA', 'CHATZOT', 'MINCHA_GEDOLA',
  'PLAG_HALACHA_BERURA', 'PLAG_YALKUT_YOSEF', 'PLAG_GRA', 'SHKIA', 'CANDLE_LIGHTING', 'CANDLE_LIGHTING_NOT_BEFORE',
];

/** eve..last inclusive, yyyy-MM-dd. */
export function daysOfBlock(eve: string, last: string): string[] {
  const out: string[] = [];
  for (let d = eve; d <= last; d = addDaysStr(d, 1)) out.push(d);
  return out;
}

/** Yom Kippur (10 Tishrei by famcal's Hebrew date) first, then Shabbat with or without a Yom Tov day, then Yom Tov alone. */
export function greetingFor(days: { date: string; hebrewDay: number; hebrewMonth: string }[], hasChag: boolean): ShabbatGreeting {
  if (days.some((d) => d.hebrewMonth === 'Tishrei' && d.hebrewDay === 10)) return 'yom_kippur';
  const shabbat = days.some((d) => weekdayIndex(d.date) === 6);
  if (hasChag) return shabbat ? 'shabbat_chag' : 'chag';
  return 'shabbat';
}

/** The day's name on the screen: its Yom Tov, else chol hamoed, else a special Shabbat, else the parasha. */
export function occasionOf(holidays: FamcalHoliday[]): string | null {
  return (
    holidays.find((h) => h.chag)?.title ??
    holidays.find((h) => h.kind === 'cholHamoed')?.title ??
    holidays.find((h) => h.kind === 'specialShabbat')?.title ??
    holidays.find((h) => h.kind === 'parasha')?.title ??
    null
  );
}

const iso = (at: string): string => new Date(at).toISOString();

export function buildShabbatTimes(input: {
  city: string;
  community: string;
  through: string;
  fetchedAt: string;
  shabbat: ShabbatAnswer;
  days: Map<string, DayAnswer>;
}): StoredShabbatTimes {
  const { shabbat, days } = input;

  const credits: ShabbatCredit[] = [];
  for (const c of [...shabbat.credits, ...[...days.values()].flatMap((d) => d.credits)]) {
    if (!credits.some((x) => x.source === c.source)) credits.push(c);
  }

  const blocks: ShabbatBlock[] = [];
  for (const block of shabbat.blocks) {
    if (!block.candleLighting.at || !block.end?.at) {
      console.warn(`[shabbat] famcal gave the stretch from ${block.eve} no candle lighting or end; it is left out`);
      continue;
    }
    const start = iso(block.candleLighting.at);
    const all = daysOfBlock(block.eve, block.last);
    const answers = all.map((d) => {
      const ans = days.get(d);
      if (!ans) throw new Error(`[shabbat] no famcal day answer for ${d}`);
      return { date: d, ans };
    });
    const rest = answers.slice(1);
    const greeting = greetingFor(
      rest.map(({ date, ans }) => ({ date, hebrewDay: ans.hebrewDate.day, hebrewMonth: ans.hebrewDate.month })),
      block.holidays.some((h) => h.chag)
    );
    const restDays = rest.map(({ date, ans }) => {
      const shkia = ans.rows.find((r) => r.key === 'SHKIA')?.at;
      return { date, hebrewDate: ans.hebrewDate.gematriya, occasion: occasionOf(ans.holidays), sunset: shkia ? iso(shkia) : null };
    });
    const rows = answers
      .flatMap(({ ans }) => ans.rows)
      .filter((r) => SHOWN_ROW_KEYS.includes(r.key) && r.at !== null && iso(r.at) > start)
      .map((r) => ({ key: r.key, name: r.name, at: iso(r.at as string) }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    blocks.push({ eve: block.eve, last: block.last, start, end: iso(block.end.at), endName: block.end.name, greeting, days: restDays, rows });
  }

  return { city: input.city, community: input.community, through: input.through, fetchedAt: input.fetchedAt, credits, blocks };
}

/** The stretches the kitchen copy carries: not over yet, and starting within SCREEN_DAYS. */
export function blocksAhead(blocks: ShabbatBlock[], today: string): ShabbatBlock[] {
  const until = addDaysStr(today, SCREEN_DAYS);
  return blocks.filter((b) => b.last >= today && b.eve <= until);
}

/** Null when the stored times reach at least WARN_DAYS ahead; else how far they do reach (null: there are none). */
export function coverageGap(times: StoredShabbatTimes | null, today: string): { through: string | null } | null {
  if (!times) return { through: null };
  return times.through < addDaysStr(today, WARN_DAYS) ? { through: times.through } : null;
}
