import type { ResolvedBadge } from '@/lib/badges';
import { badgeIconComponent } from '@/lib/badge-icons';

/**
 * A small pill in the badge's own colour.
 *
 * It was a rubber stamp before — monospace, outlined, tilted four degrees.
 * Three breads wearing one was the single thing that made the pricelist look
 * like paperwork, so the tilt and the outline are gone and the colour now sits
 * in a tint behind the word, where it reads as a label rather than an approval.
 */
export function PublicBadge({
  badge,
  small,
}: {
  badge: ResolvedBadge;
  small?: boolean;
}) {
  const Icon = badgeIconComponent(badge.iconKey);
  const iconOnly = !badge.text;
  const pad = iconOnly
    ? small ? 'p-1' : 'p-1.5'
    : small ? 'px-2 py-[3px] text-[11px]' : 'px-2.5 py-1 text-[12px]';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold leading-none ${pad}`}
      style={{
        color: badge.colorVar,
        background: `color-mix(in srgb, ${badge.colorVar} 12%, transparent)`,
      }}
    >
      {Icon && <Icon className={small ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={2.25} />}
      {badge.text}
    </span>
  );
}
