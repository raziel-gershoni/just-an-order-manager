'use client';

import { MessageCircle, BellOff } from 'lucide-react';
import { useT } from '@/hooks/useLang';
import { waHref } from '@/lib/phone-links';

export interface PickablePhone {
  id: number;
  phone: string;
  name?: string | null;
  notify?: boolean;
}

/**
 * Which number to message — a bottom sheet over the customers list.
 *
 * Only opens for customers who actually have more than one, which today is two
 * of seventeen. Both of them already label their numbers (אישי / עסקי, and one
 * per spouse), so this is a real question rather than a fallback for an
 * ambiguous list — which is why the label leads and the number is the hint.
 *
 * A silenced number is still offered. `notify` governs automatic sends; opening
 * a chat is a person deciding to talk to another person, and hiding the number
 * would break the one case this sheet exists for.
 */
export function PhonePicker({
  customerName,
  phones,
  onClose,
}: {
  customerName: string;
  phones: PickablePhone[];
  onClose: () => void;
}) {
  const t = useT();

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 animate-fade-in" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl border-t border-border bg-card pb-[calc(1rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-sm font-bold">{t('customers.pick_phone')}</h2>
          <p className="truncate text-xs text-muted-foreground">{customerName}</p>
        </div>

        <div className="px-2 pb-2">
          {phones.map((p) => {
            const href = waHref(p.phone);
            if (!href) return null;
            return (
              <a
                key={p.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-start transition-colors hover:bg-muted/50"
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-success" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.name?.trim() || t('customers.phone')}
                  </span>
                  {/* dir on the number, never on the row: an unisolated number
                      in an RTL line reorders, and a leading + lands at the far
                      end where nobody can read it. */}
                  <span dir="ltr" className="block truncate text-[11px] tabular-nums text-muted-foreground">
                    {p.phone}
                  </span>
                </span>
                {p.notify === false && (
                  <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                )}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
