/**
 * famcal's city list (its docs/api/jewish-times-v1.md, "City slugs", Israel
 * only) for the kitchen screen's Shabbat mode, with famcal's own Hebrew names.
 * A city famcal adds later shows up only after it is added here. The names are
 * famcal's data, not app copy. Client-safe: no imports.
 */

export interface FamcalCity {
  slug: string;
  name: string;
}

export const FAMCAL_CITIES: readonly FamcalCity[] = ([
  { slug: 'jerusalem', name: 'ירושלים' },
  { slug: 'tel-aviv', name: 'תל אביב' },
  { slug: 'haifa', name: 'חיפה' },
  { slug: 'rishon-lezion', name: 'ראשון לציון' },
  { slug: 'petah-tikva', name: 'פתח תקווה' },
  { slug: 'ashdod', name: 'אשדוד' },
  { slug: 'netanya', name: 'נתניה' },
  { slug: 'beer-sheva', name: 'באר שבע' },
  { slug: 'bnei-brak', name: 'בני ברק' },
  { slug: 'holon', name: 'חולון' },
  { slug: 'ramat-gan', name: 'רמת גן' },
  { slug: 'ashkelon', name: 'אשקלון' },
  { slug: 'rehovot', name: 'רחובות' },
  { slug: 'bat-yam', name: 'בת ים' },
  { slug: 'beit-shemesh', name: 'בית שמש' },
  { slug: 'kfar-saba', name: 'כפר סבא' },
  { slug: 'herzliya', name: 'הרצליה' },
  { slug: 'hadera', name: 'חדרה' },
  { slug: 'modiin', name: 'מודיעין' },
  { slug: 'lod', name: 'לוד' },
  { slug: 'ramla', name: 'רמלה' },
  { slug: 'raanana', name: 'רעננה' },
  { slug: 'nof-hagalil', name: 'נוף הגליל' },
  { slug: 'rosh-haayin', name: 'ראש העין' },
  { slug: 'afula', name: 'עפולה' },
  { slug: 'kiryat-gat', name: 'קריית גת' },
  { slug: 'nahariya', name: 'נהריה' },
  { slug: 'eilat', name: 'אילת' },
  { slug: 'tiberias', name: 'טבריה' },
  { slug: 'tzfat', name: 'צפת' },
  { slug: 'karmiel', name: 'כרמיאל' },
  { slug: 'akko', name: 'עכו' },
  { slug: 'maale-adumim', name: 'מעלה אדומים' },
  { slug: 'modiin-illit', name: 'מודיעין עילית' },
  { slug: 'beitar-illit', name: 'ביתר עילית' },
  { slug: 'elad', name: 'אלעד' },
  { slug: 'dimona', name: 'דימונה' },
  { slug: 'hod-hasharon', name: 'הוד השרון' },
  { slug: 'nes-ziona', name: 'נס ציונה' },
  { slug: 'kiryat-shmona', name: 'קריית שמונה' },
  { slug: 'ariel', name: 'אריאל' },
  { slug: 'kiryat-ata', name: 'קריית אתא' },
  { slug: 'kiryat-motzkin', name: 'קריית מוצקין' },
  { slug: 'kiryat-bialik', name: 'קריית ביאליק' },
  { slug: 'kiryat-yam', name: 'קריית ים' },
  { slug: 'givatayim', name: 'גבעתיים' },
  { slug: 'yavne', name: 'יבנה' },
  { slug: 'netivot', name: 'נתיבות' },
  { slug: 'sderot', name: 'שדרות' },
  { slug: 'harish', name: 'חריש' },
  { slug: 'zichron-yaakov', name: 'זכרון יעקב' },
] as FamcalCity[]).sort((a, b) => a.name.localeCompare(b.name, 'he'));

export function famcalCity(slug: string | null | undefined): FamcalCity | null {
  return FAMCAL_CITIES.find((c) => c.slug === slug) ?? null;
}

// Names the bakery may have typed for a city famcal lists under another name.
const ALIASES: Record<string, string> = {
  'תל אביב יפו': 'tel-aviv',
  'מודיעין מכבים רעות': 'modiin',
  'נצרת עילית': 'nof-hagalil',
};

/** Hyphens and maqaf as spaces, no niqqud or quote marks, doubled ו/י folded (קריית = קרית, תקווה = תקוה), lower case. */
function normalize(text: string): string {
  return text
    .replace(/[-־–—_]/g, ' ')
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`׳״]/g, '')
    .replace(/וו/g, 'ו')
    .replace(/יי/g, 'י')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The famcal city the bakery's own city (free text from the delivery settings) names, or null. */
export function matchFamcalCity(text: string | null | undefined): FamcalCity | null {
  const wanted = normalize(text ?? '');
  if (!wanted) return null;
  const byName = FAMCAL_CITIES.find((c) => normalize(c.name) === wanted || normalize(c.slug) === wanted);
  if (byName) return byName;
  const alias = Object.entries(ALIASES).find(([name]) => normalize(name) === wanted);
  return alias ? famcalCity(alias[1]) : null;
}
