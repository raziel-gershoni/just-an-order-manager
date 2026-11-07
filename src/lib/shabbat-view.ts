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
