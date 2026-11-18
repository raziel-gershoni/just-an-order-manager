import { hasControlChars } from './text-checks';
import {
  priceKey,
  type HomeMadeKind,
  type HomeMadeSettings,
  type LiquidKind,
  type PriceBook,
} from './cost';

/**
 * The catalogue editor's draft of one home-made ingredient (a starter or a
 * tangzhong).
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
  tangzhong: { hydration: 500, waste: 1 },
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
  // Same for the flour: "קמח אחר…" clears the name while a new one is typed,
  // and saving before typing must keep the saved flour, not wipe it.
  const flourBlank = !d.flourName?.trim();
  return {
    name: d.name,
    kind: d.kind,
    flourName: flourBlank ? (saved?.flourName ?? null) : d.flourName!.trim(),
    liquidName: liquidBlank ? (saved?.liquidName ?? WATER_NAME) : d.liquidName.trim(),
    liquidKind: liquidBlank ? (saved?.liquidKind ?? 'water') : d.liquidKind,
    hydrationPct: Math.round(clamp(d.hydration, saved?.hydrationPct ?? def.hydration, 1, 1000)),
    wasteFactor: clamp(d.waste, saved?.wasteFactor ?? def.waste, 1, 10),
  };
}

/** The name that keeps a set-up home-made ingredient unpriced, or null when it prices. */
export function missingForHomeMade(s: HomeMadeSettings, book: PriceBook): string | null {
  if (!s.flourName) return null;
  if (book.pricePerKg[priceKey(s.flourName, 'flour')] === undefined) return s.flourName;
  if (s.liquidKind === 'other') {
    const key = priceKey(s.liquidName, 'other');
    if (book.pricePerKg[key] === undefined) return s.liquidName;
  }
  return null;
}

/** Quick-fill values for the catalogue editor. Each changes only what it sets. */
export type HomeMadePreset = 'regular' | 'stiff' | 'tangzhong';

export const HOME_MADE_PRESETS: Record<
  HomeMadePreset,
  { hydration: string; waste: string; kind: HomeMadeKind }
> = {
  regular: { hydration: '100', waste: '1.5', kind: 'starter' },
  stiff: { hydration: '50', waste: '1.5', kind: 'starter' },
  tangzhong: { hydration: '500', waste: '1', kind: 'tangzhong' },
};

/** Which chips the editor offers: all when adding, the ones that fit the kind when editing. */
export function presetsFor(mode: 'add' | HomeMadeKind): HomeMadePreset[] {
  if (mode === 'add') return ['regular', 'stiff', 'tangzhong'];
  return mode === 'starter' ? ['regular', 'stiff'] : ['tangzhong'];
}

/** The kind is part of an entry's identity, so only an add may change it. */
export function applyPreset(d: HomeMadeDraft, preset: HomeMadePreset, adding: boolean): HomeMadeDraft {
  const p = HOME_MADE_PRESETS[preset];
  return {
    ...d,
    hydration: p.hydration,
    waste: p.waste,
    kind: adding ? p.kind : d.kind,
  };
}

/** A blank draft for the add form; the liquid is the bakery's own water name. */
export function newEntryDraft(defaultWater: string = WATER_NAME): HomeMadeDraft {
  return defaultDraft('', 'starter', defaultWater);
}

/**
 * Changes an add-form draft's kind. Hydration and waste still equal the OLD
 * kind's defaults are untouched, so they follow the new kind; a value the owner
 * edited stays (and so does its partner, to avoid a half-reset pair).
 */
export function switchKind(d: HomeMadeDraft, kind: HomeMadeKind): HomeMadeDraft {
  if (kind === d.kind) return d;
  const old = HOME_MADE_DEFAULTS[d.kind];
  const next = HOME_MADE_DEFAULTS[kind];
  const untouched = d.hydration === String(old.hydration) && d.waste === String(old.waste);
  return untouched ? { ...d, kind, hydration: String(next.hydration), waste: String(next.waste) } : { ...d, kind };
}

/** The editor's starting draft for a listed entry: its settings, or defaults when not set up. */
export function draftForEntry(
  entry: { name: string; kind: HomeMadeKind; saved: HomeMadeSettings | null },
  defaultWater: string
): HomeMadeDraft {
  return entry.saved ? draftFromSettings(entry.saved) : defaultDraft(entry.name, entry.kind, defaultWater);
}

/**
 * The name rules for one home-made entry, pure: the add form and the server
 * share it. `exists` only applies when creating: saving over an entry is an edit.
 */
export function homeMadeConflict(
  s: { name: string; kind: HomeMadeKind },
  saved: { name: string; kind: HomeMadeKind | string }[],
  opts: { create?: boolean }
): { code: 'blank' | 'control_chars' | 'exists' } | null {
  const name = s.name.trim();
  if (name === '') return { code: 'blank' };
  if (hasControlChars(name)) return { code: 'control_chars' };
  if (opts.create && saved.some((e) => e.name.trim() === name && e.kind === s.kind)) return { code: 'exists' };
  return null;
}
