import { cn } from '@/lib/utils';

/** Zero-pad width derived from the largest id in a list (e.g. max 431 -> 3). */
export function docketWidth(ids: number[]): number {
  return ids.length ? String(Math.max(...ids)).length : 1;
}

/**
 * A tear-off docket "stub": the id printed vertically (reading bottom-to-top)
 * along the leading edge, separated from the row content by a dashed
 * perforation. Decorative. Fixed narrow width; the id is absolutely centered
 * and rotated so the stub stays narrow regardless of id length.
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
      className={cn(
        'relative flex w-7 shrink-0 self-stretch border-e border-dashed border-muted-foreground/30 bg-muted/40',
        className
      )}
    >
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="-rotate-90 whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums tracking-wider text-muted-foreground/75">
          #{String(id).padStart(width, '0')}
        </span>
      </span>
    </span>
  );
}
