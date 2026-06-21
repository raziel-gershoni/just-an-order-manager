'use client';

import Link from 'next/link';
import { Repeat, StickyNote, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocketStub } from './DocketStub';
import { Badge } from './Badge';
import { PayStamp } from './PayStamp';

/**
 * One perforated docket row: leading ticket stub, a bold primary line (customer
 * or items) with an optional mono secondary line, and the status stamp (+ pay
 * marker) on the trailing edge. Shared across the dashboard and every order list.
 */
export function DocketRow({
  id,
  idWidth,
  href,
  primary,
  secondary,
  status,
  statusLabel,
  paid,
  showPay,
  isRecurring,
  hasNotes,
  isDelivery,
  first,
}: {
  id: number;
  idWidth: number;
  href: string;
  primary: string;
  secondary?: string;
  status: string;
  statusLabel: string;
  paid?: boolean;
  showPay?: boolean;
  isRecurring?: boolean;
  hasNotes?: boolean;
  isDelivery?: boolean;
  first?: boolean;
}) {
  return (
    <Link href={href}>
      <div
        className={cn(
          'flex items-stretch transition-colors hover:bg-muted/40',
          !first && 'border-t border-dashed border-border'
        )}
      >
        <DocketStub id={id} width={idWidth} />
        <div className="flex flex-1 items-center gap-3 px-3 py-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="font-semibold flex items-center gap-1.5 line-clamp-1">
              {isRecurring && (
                <Repeat className="h-3 w-3 text-primary shrink-0" aria-label="הזמנה קבועה" role="img">
                  <title>הזמנה קבועה</title>
                </Repeat>
              )}
              <span className="truncate">{primary}</span>
              {isDelivery && (
                <Truck className="h-3.5 w-3.5 text-primary shrink-0" aria-label="משלוח" role="img">
                  <title>משלוח</title>
                </Truck>
              )}
              {hasNotes && <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            </div>
            {secondary && (
              <div className="mt-0.5 font-mono text-[12.5px] tabular-nums text-muted-foreground line-clamp-1">
                {secondary}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Badge status={status} label={statusLabel} />
            {showPay && paid != null && <PayStamp paid={paid} />}
          </div>
        </div>
      </div>
    </Link>
  );
}
