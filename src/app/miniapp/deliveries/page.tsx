'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT, useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { groupByDeliveryDate } from '@/lib/order-grouping';
import { buildWazeLink } from '@/lib/delivery';
import { Navigation, Phone, Check, Banknote, Truck } from 'lucide-react';

interface Delivery {
  id: number;
  deliveryDate: string | null;
  status: string;
  paid: boolean;
  amount: number;
  customerName: string;
  address: string | null;
  city: string | null;
  deliveryNotes: string | null;
  phone: string | null;
}

export default function DeliveriesPage() {
  const { apiFetch } = useApi();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ deliveries: Delivery[] }>('/deliveries')
      .then((r) => setDeliveries(r.deliveries))
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Orders whose status flip already landed this session.
  const deliveredRef = useRef<Set<number>>(new Set());

  async function complete(d: Delivery, collect: boolean) {
    // The status already landed, which only happens here after a collect whose
    // PAYMENT failed. "סמן נמסר" then has nothing left to do — and letting it
    // through would clear the row with a success toast while the cash in the
    // driver's pocket is still unrecorded. Retrying the collect is the way out.
    if (!collect && deliveredRef.current.has(d.id)) {
      toast.error(t('deliv.payment_failed'));
      return;
    }
    setBusy(d.id);
    try {
      // Two calls, and the second one can fail on its own. Once the status has
      // landed there is no edge out of `delivered`, so a naive retry died on the
      // FIRST call and the driver was left holding cash beside a row he could
      // not clear. Remember what already went through and retry only the rest.
      if (!deliveredRef.current.has(d.id)) {
        await apiFetch(`/orders/${d.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'delivered', notifyCustomer: false }),
        });
        deliveredRef.current.add(d.id);
      }
      let alreadyRecorded = false;
      if (collect) {
        const res = await apiFetch<{ outcome?: string }>(`/orders/${d.id}/pay`, {
          method: 'POST',
          body: JSON.stringify({ action: 'paid', amount: d.amount.toFixed(2) }),
        });
        alreadyRecorded = res.outcome === 'already';
      }
      setDeliveries((p) => p.filter((x) => x.id !== d.id));
      // The delivery is done either way, but cash that was not recorded has to
      // be said out loud rather than confirmed. A driver has only this tab, so
      // this one does not send them to a customer card they cannot open.
      if (alreadyRecorded) toast.error(t('deliv.payment_already'));
      else toast.success(collect ? t('deliv.collected_done') : t('deliv.delivered_done'));
    } catch {
      // Name the step that failed: "delivered but the payment did not record"
      // is a different problem, and a different retry, from "nothing happened".
      toast.error(
        deliveredRef.current.has(d.id) ? t('deliv.payment_failed') : t('site.save_failed')
      );
    }
    setBusy(null);
  }

  const groups = groupByDeliveryDate(
    deliveries.map((d) => ({ ...d, totalQuantity: 0 })),
    lang
  );

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
        <Truck className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">{t('deliv.today')}</h1>
      </div>

      <div className="space-y-5 p-5">
        {loading ? (
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        ) : deliveries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Truck className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t('deliv.none')}</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-center gap-3">
                <span className="font-display text-sm font-bold">{group.label}</span>
                <span className="flex-1 border-t border-dashed border-border" />
                <span className="font-mono text-xs text-muted-foreground">{group.items.length}</span>
              </div>
              <div className="space-y-3">
                {group.items.map((d) => {
                  const waze = buildWazeLink(d.address, d.city);
                  return (
                    <Card key={d.id} className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold">{d.customerName}</div>
                          {(d.address || d.city) && (
                            <div className="text-sm text-muted-foreground">
                              {[d.address, d.city].filter(Boolean).join(', ')}
                            </div>
                          )}
                        </div>
                        <Badge status={d.paid ? 'delivered' : 'to_be_paid'} label={d.paid ? t('notify.settled') : `₪${d.amount.toFixed(0)}`} />
                      </div>

                      {d.deliveryNotes && (
                        <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">{d.deliveryNotes}</div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {waze && (
                          <a
                            href={waze}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-primary"
                          >
                            <Navigation className="h-4 w-4" />
                            {t('deliv.waze')}
                          </a>
                        )}
                        {d.phone && (
                          <a
                            href={`tel:${d.phone}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                          >
                            <Phone className="h-4 w-4" />
                            {d.phone}
                          </a>
                        )}
                      </div>

                      <div className="flex gap-2 border-t border-dashed border-border pt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          loading={busy === d.id}
                          onClick={() => complete(d, false)}
                        >
                          <Check className="h-4 w-4" />
                          {t('deliv.mark_delivered')}
                        </Button>
                        {!d.paid && d.amount > 0 && (
                          <Button
                            size="sm"
                            className="flex-1"
                            loading={busy === d.id}
                            onClick={() => complete(d, true)}
                          >
                            <Banknote className="h-4 w-4" />
                            {t('deliv.deliver_collect')}
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}
