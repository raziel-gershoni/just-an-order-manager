'use client';

import { useT } from '@/hooks/useLang';
import { t as translate } from '@/lib/i18n';
import { BADGE_PRESETS, BADGE_PRESET_KEYS } from '@/lib/badges';

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

/** Pick a badge: a preset (color-coded) or a custom label, or none. */
export function BadgePicker({
  badgeType,
  badgeLabel,
  onChange,
}: {
  badgeType: string | null;
  badgeLabel: string | null;
  onChange: (type: string | null, label: string | null) => void;
}) {
  const t = useT();
  const isCustom = badgeType === 'custom';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Chip selected={!badgeType} label={t('site.badge_none')} onClick={() => onChange(null, null)} />
        {BADGE_PRESET_KEYS.map((key) => (
          <Chip
            key={key}
            selected={badgeType === key}
            color={BADGE_PRESETS[key].colorVar}
            label={translate(BADGE_PRESETS[key].labelKey)}
            onClick={() => onChange(key, null)}
          />
        ))}
        <Chip
          selected={isCustom}
          label={t('site.badge_custom')}
          onClick={() => onChange('custom', badgeLabel ?? '')}
        />
      </div>
      {isCustom && (
        <input
          value={badgeLabel ?? ''}
          maxLength={40}
          onChange={(e) => onChange('custom', e.target.value)}
          placeholder={t('site.badge_field')}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
