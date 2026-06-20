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
 *  + icon key, or null when there's neither text nor icon. Text and icon are
 *  independent — an icon with no text is a valid (icon-only) badge. */
export function resolveBadge(
  badgeType: string | null | undefined,
  badgeLabel: string | null | undefined,
  badgeIcon?: string | null,
  lang?: Lang
): ResolvedBadge | null {
  const iconKey = badgeIcon ?? null;
  let text = '';
  let colorVar = 'var(--primary)';

  if (badgeType === 'custom') {
    text = (badgeLabel ?? '').trim();
  } else if (badgeType) {
    const preset = BADGE_PRESETS[badgeType as BadgePreset];
    if (preset) {
      text = t(preset.labelKey, lang);
      colorVar = preset.colorVar;
    }
  }

  if (!text && !iconKey) return null;
  return { text, colorVar, iconKey };
}
