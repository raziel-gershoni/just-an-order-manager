import type { ResolvedBadge } from '@/lib/badges';

/** A tilted rubber-stamp badge (DOCKET). Color comes from the resolved badge. */
export function PublicBadge({
  badge,
  small,
}: {
  badge: ResolvedBadge;
  small?: boolean;
}) {
  return (
    <span
      className={`inline-block -rotate-[4deg] rounded font-mono font-bold leading-none ${
        small ? 'px-1.5 py-[2px] text-[9px]' : 'px-2 py-[3px] text-[10px]'
      }`}
      style={{ color: badge.colorVar, border: `1.5px solid ${badge.colorVar}` }}
    >
      {badge.text}
    </span>
  );
}
