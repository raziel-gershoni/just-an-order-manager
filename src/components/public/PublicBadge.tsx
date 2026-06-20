import type { ResolvedBadge } from '@/lib/badges';
import { badgeIconComponent } from '@/lib/badge-icons';

/** A tilted rubber-stamp badge (DOCKET). Color comes from the resolved badge.
 *  An optional icon sits before the text. */
export function PublicBadge({
  badge,
  small,
}: {
  badge: ResolvedBadge;
  small?: boolean;
}) {
  const Icon = badgeIconComponent(badge.iconKey);
  return (
    <span
      className={`inline-flex items-center gap-1 -rotate-[4deg] rounded font-mono font-bold leading-none ${
        small ? 'px-1.5 py-[2px] text-[9px]' : 'px-2 py-[3px] text-[10px]'
      }`}
      style={{ color: badge.colorVar, border: `1.5px solid ${badge.colorVar}` }}
    >
      {Icon && <Icon className={small ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={2.5} />}
      {badge.text}
    </span>
  );
}
