import { Wheat } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DOCKET section separator — a spaced label and a dashed rule running off to the
 * side. Doubles as the date header for upcoming groups (the label IS the date),
 * with an optional per-day loaf count. `warn` tints it destructive-red.
 */
export function SectionHead({
  label,
  loaves,
  warn,
}: {
  label: string;
  loaves?: number;
  warn?: boolean;
}) {
  return (
    <div className="mx-5 mt-5 mb-2 flex items-center gap-2.5">
      <h2
        className={cn(
          'text-[13px] font-extrabold tracking-[0.1em]',
          warn ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {label}
      </h2>
      {loaves != null && loaves > 0 && (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
          <Wheat className="h-3 w-3" />
          {loaves}
        </span>
      )}
      <span
        className={cn(
          'h-0 flex-1 border-t border-dashed',
          warn ? 'border-destructive/40' : 'border-border'
        )}
        aria-hidden
      />
    </div>
  );
}
