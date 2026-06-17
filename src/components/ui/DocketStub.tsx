import { cn } from '@/lib/utils';

/** Zero-pad width derived from the largest id in a list (e.g. max 431 -> 3). */
export function docketWidth(ids: number[]): number {
  return ids.length ? String(Math.max(...ids)).length : 1;
}

/**
 * A tear-off docket "stub": the id printed vertically along the leading edge,
 * separated from the row content by a dashed perforation. Decorative.
 */
export function DocketStub({
  id,
  width,
  className,
}: {
  id: number;
  width: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ writingMode: 'vertical-rl' }}
      className={cn(
        'flex shrink-0 items-center justify-center self-stretch border-e border-dashed border-border bg-muted/40 px-[5px] py-1.5 font-mono text-[11px] font-semibold tabular-nums tracking-wider text-muted-foreground/80',
        className
      )}
    >
      #{String(id).padStart(width, '0')}
    </span>
  );
}
