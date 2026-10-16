'use client';

import Link from 'next/link';
import { CalendarClock, Pencil, X } from 'lucide-react';
import { useT } from '@/hooks/useLang';
import { formatWeekdayShort } from '@/lib/date-utils';
import { formatStaffItemLabel } from '@/lib/order-display';
import type { NextOccurrenceView } from '@/lib/order-next-change-types';

/**
 * A change saved for the next occurrence, under the recurring row: when it
 * starts and exactly what it changes, so either of the two people running the
 * bakery sees it before editing this week's order.
 */
export function NextChangeCard({
  view,
  orderIsDelivery,
  canEdit,
  editHref,
  discarding,
  onDiscard,
}: {
  view: NextOccurrenceView;
  orderIsDelivery: boolean;
  canEdit: boolean;
  editHref: string;
  discarding: boolean;
  onDiscard: () => void;
}) {
  const t = useT();
  const change = view.change!;
  const basket = change.basket;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 animate-expand">
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium">
            {t('orders.next_change_from').replace('{date}', formatWeekdayShort(view.date!))}
          </div>
          {basket && (
            <div className="text-xs">
              <span className="text-muted-foreground">{t('orders.next_change_items')}: </span>
              {basket.items
                .map(
                  (i) =>
                    `${i.quantity} ${formatStaffItemLabel(
                      i.breadTypeName ?? '?',
                      i.sizeName,
                      null,
                      i.additions.map((a) => a.name)
                    )}`
                )
                .join(', ')}
              {' · '}
              <span dir="ltr" className="font-medium tabular-nums">₪{Math.round(basket.total)}</span>
              {basket.isDelivery !== orderIsDelivery && (
                <> · {basket.isDelivery ? t('deliv.checkbox') : t('deliv.pickup')}</>
              )}
            </div>
          )}
          {change.notes !== undefined && (
            <div className="text-xs">
              <span className="text-muted-foreground">{t('orders.next_change_notes')}: </span>
              {change.notes ?? t('orders.next_change_no_notes')}
            </div>
          )}
          {change.schedule && (
            <div className="text-xs">
              <span className="text-muted-foreground">{t('orders.next_change_day')}: </span>
              {formatWeekdayShort(view.date!)}
            </div>
          )}
        </div>
        {canEdit && (
          <div className="-my-2 -me-2 flex shrink-0 items-center">
            <Link
              href={editHref}
              aria-label={t('orders.next_change_edit')}
              title={t('orders.next_change_edit')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              aria-label={t('orders.next_change_discard')}
              title={t('orders.next_change_discard')}
              disabled={discarding}
              onClick={onDiscard}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
