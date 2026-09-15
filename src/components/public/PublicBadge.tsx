import type { ResolvedBadge } from '@/lib/badges';
import { badgeIconComponent } from '@/lib/badge-icons';

/**
 * A small solid chip in the badge's own colour.
 *
 * It was a rubber stamp before — monospace, outlined, tilted four degrees —
 * and three breads wearing one was most of what made the pricelist look like
 * paperwork. Solid rather than tinted: on a warm ground a tint goes muddy, and
 * a painted sign would have used the colour at full strength.
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
    : small ? 'px-[7px] py-[3px] text-[11px]' : 'px-2.5 py-1 text-[12.5px]';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[3px] font-bold leading-none text-white ${pad}`}
      style={{ background: badge.colorVar }}
    >
      {Icon && <Icon className={small ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={2.25} />}
      {badge.text}
    </span>
  );
}
