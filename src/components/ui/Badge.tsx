'use client';

import { cn } from '@/lib/utils';

/**
 * DOCKET status "rubber stamp". Colors come from the shared --status-* tokens
 * (single source, also used by the border-status-* ticks), so it themes itself
 * in both light front-of-house and dark back-office.
 */
export function Badge({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}) {
  const v = `var(--status-${status}, var(--muted-foreground))`;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border px-2 py-0.5 text-[11px] font-semibold tracking-wide -rotate-3',
        className
      )}
      style={{
        color: v,
        borderColor: v,
        backgroundColor: `color-mix(in oklab, ${v} 14%, var(--card))`,
      }}
    >
      {label}
    </span>
  );
}
