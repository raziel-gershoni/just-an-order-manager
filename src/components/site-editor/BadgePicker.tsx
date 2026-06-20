'use client';

import { useT } from '@/hooks/useLang';
import { t as translate } from '@/lib/i18n';
import { BADGE_PRESETS, BADGE_PRESET_KEYS } from '@/lib/badges';
import { BADGE_ICONS, BADGE_ICON_KEYS } from '@/lib/badge-icons';

function Chip({
  selected,
  label,
  color,
  onClick,
}: {
  selected: boolean;
  label: string;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full border px-2.5 py-1 text-[12px] font-semibold ' +
        (selected ? '' : 'border-border text-muted-foreground')
      }
      style={
        selected
          ? { color: color ?? 'var(--primary)', borderColor: color ?? 'var(--primary)' }
          : undefined
      }
    >
      {label}
    </button>
  );
}

/** Pick a badge: a preset (color-coded) or a custom label, or none — plus an
 *  optional icon (independent of the text). */
export function BadgePicker({
  badgeType,
  badgeLabel,
  badgeIcon,
  onChange,
}: {
  badgeType: string | null;
  badgeLabel: string | null;
  badgeIcon: string | null;
  onChange: (type: string | null, label: string | null, icon: string | null) => void;
}) {
  const t = useT();
  const isCustom = badgeType === 'custom';

  return (
    <div className="space-y-2">
      {/* Text: a preset, a custom label, or none (icon can still stand alone) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-0.5 text-[11px] text-muted-foreground">{t('site.text_field')}</span>
        <Chip selected={!badgeType} label={t('site.badge_none')} onClick={() => onChange(null, null, badgeIcon)} />
        {BADGE_PRESET_KEYS.map((key) => (
          <Chip
            key={key}
            selected={badgeType === key}
            color={BADGE_PRESETS[key].colorVar}
            label={translate(BADGE_PRESETS[key].labelKey)}
            onClick={() => onChange(key, null, badgeIcon)}
          />
        ))}
        <Chip
          selected={isCustom}
          label={t('site.badge_custom')}
          onClick={() => onChange('custom', badgeLabel ?? '', badgeIcon)}
        />
      </div>

      {isCustom && (
        <input
          value={badgeLabel ?? ''}
          maxLength={40}
          onChange={(e) => onChange('custom', e.target.value, badgeIcon)}
          placeholder={t('site.badge_field')}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        />
      )}

      {/* Icon — optional, independent of the text (so an icon can stand alone) */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="me-0.5 text-[11px] text-muted-foreground">{t('site.icon_field')}</span>
        <button
          type="button"
          aria-label="no-icon"
          onClick={() => onChange(badgeType, badgeLabel, null)}
          className={
            'grid h-7 w-7 place-items-center rounded-md border text-sm ' +
            (!badgeIcon ? 'border-primary text-primary' : 'border-border text-muted-foreground')
          }
        >
          —
        </button>
        {BADGE_ICON_KEYS.map((key) => {
          const Icon = BADGE_ICONS[key];
          return (
            <button
              key={key}
              type="button"
              aria-label={key}
              onClick={() => onChange(badgeType, badgeLabel, key)}
              className={
                'grid h-7 w-7 place-items-center rounded-md border ' +
                (badgeIcon === key ? 'border-primary text-primary' : 'border-border text-muted-foreground')
              }
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
