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
        'inline-flex items-center rounded-[4px] border-[1.5px] px-2.5 py-[3px] text-[11.5px] font-extrabold tracking-[0.06em] -rotate-[4deg]',
        className
      )}
      style={{
        color: v,
        borderColor: v,
        backgroundColor: `color-mix(in oklab, ${v} 16%, var(--card))`,
        boxShadow: 'inset 0 0 6px rgba(0,0,0,0.10)',
      }}
    >
      {label}
    </span>
  );
}
