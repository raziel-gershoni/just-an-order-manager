import { Wheat } from 'lucide-react';

/**
 * A perforated date-section separator for docket lists. The date lives here
 * (not on each row); the optional loaf count is the per-day production total.
 */
export function DateGroupHeader({ label, loaves }: { label: string; loaves?: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-y border-dashed border-border bg-muted/40 px-3 py-1.5 first:border-t-0">
      <span className="text-xs font-semibold tracking-wide text-foreground/70">{label}</span>
      {loaves != null && loaves > 0 && (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
          <Wheat className="h-3 w-3" />
          {loaves}
        </span>
      )}
    </div>
  );
}
