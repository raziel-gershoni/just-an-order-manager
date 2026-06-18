import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DOCKET payment marker — a small tilted rubber stamp, green "שולם" / red
 * "לא שולם", paired with the status stamp on a docket row.
 */
export function PayStamp({ paid, className }: { paid: boolean; className?: string }) {
  const v = paid ? 'var(--status-ready)' : 'var(--status-cancelled)';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[4px] border-[1.2px] px-2 py-[2px] text-[10px] font-extrabold tracking-[0.04em] -rotate-[3deg]',
        className
      )}
      style={{
        color: v,
        borderColor: v,
        backgroundColor: `color-mix(in oklab, ${v} 11%, var(--card))`,
      }}
    >
      {paid ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      {paid ? 'שולם' : 'לא שולם'}
    </span>
  );
}
