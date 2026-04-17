'use client';

import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = ['pending', 'confirmed', 'baking', 'ready', 'delivered'] as const;

export function StatusFlow({
  status,
  labels,
}: {
  status: string;
  labels: Record<string, string>;
}) {
  if (status === 'cancelled') {
    return (
      <div className="flex items-center justify-center py-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm font-medium">
          <X className="h-4 w-4" />
          {labels.cancelled || 'Cancelled'}
        </span>
      </div>
    );
  }

  const currentIdx = STEPS.indexOf(status as any);

  return (
    <div className="flex items-center gap-0.5 py-4 px-1">
      {STEPS.map((step, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;

        return (
          <div key={step} className="flex-1 flex flex-col items-center gap-2">
            <div className="flex items-center w-full">
              {i > 0 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 rounded-full transition-colors',
                    i <= currentIdx ? 'bg-emerald-400' : 'bg-border'
                  )}
                />
              )}
              <div
                className={cn(
                  'w-4 h-4 rounded-full shrink-0 flex items-center justify-center transition-all',
                  isCompleted && 'bg-emerald-500',
                  isCurrent && 'bg-primary ring-[3px] ring-primary/20',
                  !isCompleted && !isCurrent && 'bg-muted border border-border'
                )}
              >
                {isCompleted && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 rounded-full transition-colors',
                    i < currentIdx ? 'bg-emerald-400' : 'bg-border'
                  )}
                />
              )}
            </div>
            <span
              className={cn(
                'text-[10px] leading-tight text-center',
                isCurrent && 'font-bold text-foreground',
                isCompleted && 'text-muted-foreground',
                !isCompleted && !isCurrent && 'text-muted-foreground/40'
              )}
            >
              {labels[step] || step}
            </span>
          </div>
        );
      })}
    </div>
  );
}
