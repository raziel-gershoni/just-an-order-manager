'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT, useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { useGroup } from '@/hooks/useGroup';
import { ASAP_GROUP_KEY, groupByDeliveryDate } from '@/lib/order-grouping';
import { waHref } from '@/lib/phone-links';
import { buildWazeLink } from '@/lib/delivery';
import { formatDateRelative } from '@/lib/date-utils';
import type { RouteAnswer } from '@/lib/delivery-route';
import { Banknote, Check, CircleCheck, Map as MapIcon, MessageCircle, MessageCircleOff, Navigation, Truck } from 'lucide-react';

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
  /** False when the owner marked every one of the customer's numbers as off WhatsApp. */
  phoneHasWhatsapp: boolean;
}

/** A delivery of today that nobody has marked ready yet. */
interface NotReady {
  id: number;
  deliveryDate: string | null;
  status: string;
  customerName: string;
  address: string | null;
  city: string | null;
}

function DeliveryCard({
  d,
  t,
  busy,
  onComplete,
  number,
  pills = [],
  showAsapLine = false,
}: {
  d: Delivery;
  t: (key: string) => string;
  busy: boolean;
  onComplete: (d: Delivery, collect: boolean) => void;
  /** Stop number in the route; absent in the date-grouped layout. */
  number?: number;
  pills?: string[];
  /** The date-grouped layout's own "בהקדם" line under the name. */
  showAsapLine?: boolean;
}) {
  const waze = buildWazeLink(d.address, d.city);
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        {number != null && (
          <span className="w-6 shrink-0 font-mono text-lg font-bold leading-6 tabular-nums text-primary">
            {number}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{d.customerName}</span>
            {pills.map((label) => (
              <span
                key={label}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
          {showAsapLine && (
            <div className="text-xs text-muted-foreground">{t('delivery.asap')}</div>
          )}
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
        {/* WhatsApp, not tel: — Telegram's WebView drops the tel
            scheme on both platforms and exposes no call API, so
            the call button did nothing where this app is used.
            dir on the digits alone: a number carrying a leading
            + rendered with the plus at the far end. */}
        {d.phone &&
          (d.phoneHasWhatsapp && waHref(d.phone) ? (
            <a
              href={waHref(d.phone)!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-success"
            >
              <MessageCircle className="h-4 w-4" />
              <span dir="ltr" className="tabular-nums">{d.phone}</span>
            </a>
          ) : (
            // A landline, a foreign number, or one the owner
            // marked as off WhatsApp has no chat to open. The
            // digits still have to be on screen: this tab is the
            // driver's only one, and they cannot open the
            // customer card to look them up.
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground">
              {d.phoneHasWhatsapp ? (
                <MessageCircle className="h-4 w-4 opacity-40" />
              ) : (
                <MessageCircleOff className="h-4 w-4 opacity-60" />
              )}
              <span dir="ltr" className="tabular-nums">{d.phone}</span>
            </span>
          ))}
      </div>

      <div className="flex gap-2 border-t border-dashed border-border pt-3">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          loading={busy}
          onClick={() => onComplete(d, false)}
        >
          <Check className="h-4 w-4" />
          {t('deliv.mark_delivered')}
        </Button>
        {!d.paid && d.amount > 0 && (
          <Button
            size="sm"
            className="flex-1"
            loading={busy}
            onClick={() => onComplete(d, true)}
          >
            <Banknote className="h-4 w-4" />
            {t('deliv.deliver_collect')}
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function DeliveriesPage() {
  const { apiFetch } = useApi();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { activeGroupRole } = useGroup();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [notReady, setNotReady] = useState<NotReady[]>([]);
  // The server's day and the bakery's בהקדם switch, which place undated orders.
  const [display, setDisplay] = useState<{ today: string; asapInToday: boolean }>({ today: '', asapInToday: false });
  const [route, setRoute] = useState<RouteAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  // Only the newest route request may land: a slow answer for an older
  // position must not overwrite the one asked for after the last delivery.
  const routeSeq = useRef(0);

  // Google being down or the call failing must not hide the deliveries, so a
  // failed route request is an answer too ('failed': the date-grouped list).
  async function loadRoute(fromOrderId?: number) {
    const seq = ++routeSeq.current;
    let answer: RouteAnswer;
    try {
      answer = await apiFetch<RouteAnswer>(
        `/deliveries/route-order${fromOrderId ? `?from=${fromOrderId}` : ''}`
      );
    } catch (err) {
      console.error('[deliveries] route order failed:', err);
      answer = { status: 'failed', canManage: false, stops: [], unplaced: [], maps: null };
    }
    if (seq === routeSeq.current) setRoute(answer);
  }

  // Orders whose status flip already landed this session.
  const deliveredRef = useRef<Set<number>>(new Set());

  function loadList() {
    return apiFetch<{ deliveries: Delivery[]; notReady: NotReady[]; today: string; asapInToday: boolean }>('/deliveries')
      .then((r) => {
        // A stop delivered here whose payment failed is no longer on the
        // server's list, yet its card is the driver's only way to retry the
        // payment: a re-read keeps it.
        setDeliveries((prev) => [
          ...r.deliveries,
          ...prev.filter((x) => deliveredRef.current.has(x.id) && !r.deliveries.some((y) => y.id === x.id)),
        ]);
        setNotReady(r.notReady);
        setDisplay({ today: r.today, asapInToday: r.asapInToday });
      })
      .catch((err) => {
        console.error('[deliveries] load failed:', err);
        toast.error(t('deliv.load_failed'));
      });
  }

  useEffect(() => {
    // The skeleton stays until both have answered.
    Promise.all([loadList(), loadRoute()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The stop delivered last, where a re-planned route starts; home before the first.
  const lastDeliveredRef = useRef<number | undefined>(undefined);

  // Marks a delivery the kitchen forgot as ready, so it joins the run. Same
  // transition as the order page and the bot's buttons, customer message
  // included. A waiting order is approved first: the state machine has no
  // step straight from waiting to ready.
  async function markReady(n: NotReady) {
    setBusy(n.id);
    try {
      if (n.status === 'pending') {
        await apiFetch(`/orders/${n.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'confirmed' }),
        });
      }
      await apiFetch(`/orders/${n.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ready', notifyCustomer: true }),
      });
      toast.success(t('deliv.marked_ready'));
    } catch (e) {
      console.error(`[deliveries] marking order ${n.id} ready failed (was ${n.status}):`, e);
      toast.error(t('orders.update_failed'));
    }
    // Either way the lists are read again: a half-done step (approved, not yet
    // ready) must show as it now is, and a ready stop joins the route.
    await Promise.all([loadList(), loadRoute(lastDeliveredRef.current)]);
    setBusy(null);
  }

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
      // The route is re-planned from this stop's address. Dropping it locally
      // first keeps the card gone from the list while the new order is fetched;
      // the Maps link would still lead back to this stop, so it waits for the new one.
      setRoute((r) => (r ? { ...r, stops: r.stops.filter((x) => x.orderId !== d.id), maps: null } : r));
      lastDeliveredRef.current = d.id;
      void loadRoute(d.id);
      // The delivery is done either way, but cash that was not recorded has to
      // be said out loud rather than confirmed. A driver has only this tab, so
      // this one does not send them to a customer card they cannot open.
      if (alreadyRecorded) toast.error(t('deliv.payment_already'));
      else toast.success(collect ? t('deliv.collected_done') : t('deliv.delivered_done'));
    } catch (e) {
      console.error(
        `[deliveries] completing order ${d.id} failed (collect=${collect}, delivered=${deliveredRef.current.has(d.id)}):`,
        e
      );
      // Name the step that failed: "delivered but the payment did not record"
      // is a different problem, and a different retry, from "nothing happened".
      toast.error(
        deliveredRef.current.has(d.id) ? t('deliv.payment_failed') : t('site.save_failed')
      );
    }
    setBusy(null);
  }

  const byId = new Map(deliveries.map((d) => [d.id, d]));
  const dateTag = (d: { deliveryDate: string | null }) =>
    d.deliveryDate == null
      ? t('delivery.asap')
      : d.deliveryDate === display.today
        ? null
        : formatDateRelative(d.deliveryDate, 'he');

  // Why the list is not in route order, one line above the date groups.
  const noteKey =
    route?.status === 'no_home'
      ? route.canManage
        ? 'route.no_home'
        : 'route.no_home_driver'
      : route?.status === 'home_not_found'
        ? route.canManage
          ? 'route.home_not_found'
          : 'route.home_not_found_driver'
        : route?.status === 'too_many'
          ? 'route.too_many'
          : route?.status === 'failed'
            ? 'route.failed'
            : null;

  let routeList: ReactNode = null;
  if (route?.status === 'ok') {
    const stops = route.stops.filter((s) => byId.has(s.orderId));
    const unplaced = route.unplaced.map((id) => byId.get(id)).filter((d): d is Delivery => !!d);
    const placed = new Set([...route.stops.map((s) => s.orderId), ...route.unplaced]);
    // A delivery the route knows nothing about (it arrived after the plan was
    // made) still has to be on the screen, without a number.
    const unknown = deliveries.filter((d) => !placed.has(d.id));
    routeList = (
      <>
        {route.maps && (
          <a
            href={route.maps.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-primary"
          >
            <MapIcon className="h-4 w-4" />
            {t(route.maps.partial ? 'route.maps_next' : 'route.maps_all')}
          </a>
        )}
        <div className="space-y-3">
          {stops.map((s, i) => {
            const d = byId.get(s.orderId)!;
            const pills = [dateTag(d), s.rough ? t('route.check_address') : null].filter(
              (x): x is string => !!x
            );
            return (
              <DeliveryCard
                key={d.id}
                d={d}
                t={t}
                busy={busy === d.id}
                onComplete={complete}
                number={i + 1}
                pills={pills}
              />
            );
          })}
          {unknown.map((d) => (
            <DeliveryCard
              key={d.id}
              d={d}
              t={t}
              busy={busy === d.id}
              onComplete={complete}
              pills={[dateTag(d)].filter((x): x is string => !!x)}
            />
          ))}
        </div>
        {unplaced.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-3">
              <span className="font-display text-sm font-bold">{t('route.unplaced')}</span>
              <span className="flex-1 border-t border-dashed border-border" />
              <span className="font-mono text-xs text-muted-foreground">{unplaced.length}</span>
            </div>
            <div className="space-y-3">
              {unplaced.map((d) => (
                <DeliveryCard
                  key={d.id}
                  d={d}
                  t={t}
                  busy={busy === d.id}
                  onComplete={complete}
                  pills={[dateTag(d)].filter((x): x is string => !!x)}
                />
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  const groups = groupByDeliveryDate(
    deliveries.map((d) => ({ ...d, totalQuantity: 0 })),
    lang,
    { ...display, order: 'soonest' }
  );

  const dateGroups = (
    <>
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-center gap-3">
                <span className="font-display text-sm font-bold">{group.label}</span>
                <span className="flex-1 border-t border-dashed border-border" />
                <span className="font-mono text-xs text-muted-foreground">{group.items.length}</span>
              </div>
              <div className="space-y-3">
                {group.items.map((d) => (
                  <DeliveryCard
                    key={d.id}
                    d={d}
                    t={t}
                    busy={busy === d.id}
                    onComplete={complete}
                    showAsapLine={d.deliveryDate == null && group.key !== ASAP_GROUP_KEY}
                  />
                ))}
              </div>
            </section>
          ))}
    </>
  );

  const notReadySection = notReady.length > 0 && (
    <section>
      <div className="mb-2 flex items-center gap-3">
        <span className="font-display text-sm font-bold">{t('deliv.not_ready')}</span>
        <span className="flex-1 border-t border-dashed border-border" />
        <span className="font-mono text-xs text-muted-foreground">{notReady.length}</span>
      </div>
      <div className="space-y-3">
        {notReady.map((n) => (
          <Card key={n.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold">{n.customerName}</span>
                {[t(`status.${n.status}`), dateTag(n)]
                  .filter((x): x is string => !!x)
                  .map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
              </div>
              {(n.address || n.city) && (
                <div className="text-sm text-muted-foreground">
                  {[n.address, n.city].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              loading={busy === n.id}
              disabled={busy !== null && busy !== n.id}
              onClick={() => markReady(n)}
            >
              <CircleCheck className="h-4 w-4" />
              {t('deliv.mark_ready')}
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );

  return (
    <>
      {/* Owner and managers come here from the homepage and need the way back;
          for a driver this screen is home, so there is nothing to go back to. */}
      {activeGroupRole === 'owner' || activeGroupRole === 'manager' ? (
        <PageHeader title={t('deliv.today')} />
      ) : (
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
          <Truck className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">{t('deliv.today')}</h1>
        </div>
      )}

      <div className="space-y-5 p-5">
        {loading ? (
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        ) : deliveries.length === 0 ? (
          <>
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <Truck className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t('deliv.none')}</p>
            </div>
            {notReadySection}
          </>
        ) : (
          <>
            {noteKey && <p className="text-sm text-muted-foreground">{t(noteKey)}</p>}
            {route?.status === 'ok' ? routeList : dateGroups}
            {notReadySection}
          </>
        )}
      </div>
    </>
  );
}
