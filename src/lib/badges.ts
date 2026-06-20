import { t, type Lang } from './i18n';

// Owner-set badges shown on the public pricelist. A badge is either a preset
// (label from i18n + a fixed DOCKET color) or a free custom label.
export type BadgePreset =
  | 'popular'
  | 'new'
  | 'recommended'
  | 'shabbat'
  | 'sold_out';

export const BADGE_PRESETS: Record<
  BadgePreset,
  { labelKey: string; colorVar: string }
> = {
  popular: { labelKey: 'badge.popular', colorVar: 'var(--primary)' },
  new: { labelKey: 'badge.new', colorVar: 'var(--success)' },
  recommended: { labelKey: 'badge.recommended', colorVar: 'var(--warning)' },
  shabbat: { labelKey: 'badge.shabbat', colorVar: 'var(--destructive)' },
  sold_out: { labelKey: 'badge.sold_out', colorVar: 'var(--muted-foreground)' },
};

export const BADGE_PRESET_KEYS = Object.keys(BADGE_PRESETS) as BadgePreset[];

export type ResolvedBadge = {
  text: string;
  colorVar: string;
  iconKey: string | null;
};

/** Resolve stored (badgeType, badgeLabel, badgeIcon) into display text + color
 *  + icon key, or null when there's no badge. The icon is independent of the
 *  preset — a separate manual pick. */
export function resolveBadge(
  badgeType: string | null | undefined,
  badgeLabel: string | null | undefined,
  badgeIcon?: string | null,
  lang?: Lang
): ResolvedBadge | null {
  const iconKey = badgeIcon ?? null;
  if (!badgeType) return null;
  if (badgeType === 'custom') {
    const text = (badgeLabel ?? '').trim();
    return text ? { text, colorVar: 'var(--primary)', iconKey } : null;
  }
  const preset = BADGE_PRESETS[badgeType as BadgePreset];
  if (!preset) return null;
  return { text: t(preset.labelKey, lang), colorVar: preset.colorVar, iconKey };
}
