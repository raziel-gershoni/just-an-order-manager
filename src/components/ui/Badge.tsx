'use client';

import { cn } from '@/lib/utils';

const statusColors: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  confirmed: 'bg-sky-50 text-sky-800 border-sky-200',
  baking: 'bg-orange-50 text-orange-800 border-orange-200',
  ready: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  delivered: 'bg-stone-100 text-stone-600 border-stone-200',
  to_be_paid: 'bg-amber-50 text-amber-800 border-amber-300',
  cancelled: 'bg-red-50 text-red-800 border-red-200',
};

export function Badge({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        statusColors[status] ?? 'bg-stone-100 text-stone-800 border-stone-200',
        className
      )}
    >
      {label}
    </span>
  );
}
