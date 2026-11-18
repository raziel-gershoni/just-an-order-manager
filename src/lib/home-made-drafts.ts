import {
  priceKey,
  type HomeMadeKind,
  type HomeMadeSettings,
  type LiquidKind,
  type PriceBook,
} from './cost';

/**
 * The prices screen's draft of one home-made ingredient (starter, tangzhong).
 *
 * Pure and shared with the offline tests. Numbers are held as the strings the
 * owner typed, so a half-typed "1." is not fought on every keystroke; they are
 * turned into settings only through draftToSettings.
 */
export interface HomeMadeDraft {
  name: string;
  kind: HomeMadeKind;
  flourName: string | null;
  liquidName: string;
  liquidKind: LiquidKind;
  hydration: string;
  waste: string;
}

/** Defaults for a home-made ingredient with no saved row. */
export const HOME_MADE_DEFAULTS: Record<HomeMadeKind, { hydration: number; waste: number }> = {
  starter: { hydration: 100, waste: 1.5 },
  other: { hydration: 100, waste: 1 },
};

export const WATER_NAME = 'מים';

/** A typed number, or the fallback when the box is blank or out of range. */
export function clamp(raw: string, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

export function draftFromSettings(s: HomeMadeSettings): HomeMadeDraft {
  return {
    name: s.name,
    kind: s.kind,
    flourName: s.flourName,
    liquidName: s.liquidName,
    liquidKind: s.liquidKind,
    hydration: String(s.hydrationPct),
    waste: String(s.wasteFactor),
  };
}

export function defaultDraft(name: string, kind: HomeMadeKind, liquidName: string): HomeMadeDraft {
  return {
    name,
    kind,
    flourName: null,
    liquidName,
    liquidKind: 'water',
    hydration: String(HOME_MADE_DEFAULTS[kind].hydration),
    waste: String(HOME_MADE_DEFAULTS[kind].waste),
  };
}

/**
 * Settings from a draft. A blank or out-of-range hydration or waste falls back
 * to the SAVED value, else to the kind's default, never to a bare constant:
 * clearing a field to retype it must not save a different number over the
 * stored one.
 */
export function draftToSettings(d: HomeMadeDraft, saved?: HomeMadeSettings): HomeMadeSettings {
  const def = HOME_MADE_DEFAULTS[d.kind];
  // A cleared liquid name (a new one being typed) falls back to the saved
  // liquid, else water, for the same reason.
  const liquidBlank = d.liquidName.trim() === '';
  return {
    name: d.name,
    kind: d.kind,
    flourName: d.flourName?.trim() ? d.flourName.trim() : null,
    liquidName: liquidBlank ? (saved?.liquidName ?? WATER_NAME) : d.liquidName.trim(),
    liquidKind: liquidBlank ? (saved?.liquidKind ?? 'water') : d.liquidKind,
    hydrationPct: Math.round(clamp(d.hydration, saved?.hydrationPct ?? def.hydration, 1, 1000)),
    wasteFactor: clamp(d.waste, saved?.wasteFactor ?? def.waste, 1, 10),
  };
}

/**
 * Initial drafts: every saved row, plus every in-use starter with none (defaults,
 * liquid = the first in-use water name, else "מים").
 */
export function buildDrafts(
  saved: HomeMadeSettings[],
  inUse: { name: string; kind: string }[],
  defaultWater: string
): Record<string, HomeMadeDraft> {
  const out: Record<string, HomeMadeDraft> = {};
  for (const s of saved) out[priceKey(s.name, s.kind)] = draftFromSettings(s);
  const water = inUse.find((i) => i.kind === 'water')?.name ?? defaultWater;
  for (const i of inUse) {
    const key = priceKey(i.name, i.kind as HomeMadeKind);
    if (i.kind === 'starter' && !(key in out)) out[key] = defaultDraft(i.name, 'starter', water);
  }
  return out;
}

/** The name that keeps a set-up home-made ingredient unpriced, or null when it prices. */
export function missingForHomeMade(s: HomeMadeSettings, book: PriceBook): string | null {
  if (!s.flourName) return null;
  if (book.pricePerKg[priceKey(s.flourName, 'flour')] === undefined) return s.flourName;
  if (s.liquidKind === 'other') {
    const key = priceKey(s.liquidName, 'other');
    if (key in book.homeMade || book.pricePerKg[key] === undefined) return s.liquidName;
  }
  return null;
}
