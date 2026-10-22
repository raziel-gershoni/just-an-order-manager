'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useT, useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusFlow } from '@/components/orders/StatusFlow';
import { formatDateRelative, formatDayMonth } from '@/lib/date-utils';
import { t as translate } from '@/lib/i18n';
import { Calendar, Pencil, AlertTriangle, Repeat, ChefHat, Truck, Navigation, ChevronLeft, Undo2, Check, Wallet } from 'lucide-react';
import { ORDER_STATUS_REVERSALS } from '@/lib/constants';
import { useGroup } from '@/hooks/useGroup';
import { buildWazeLink } from '@/lib/delivery';
import { groupByKind } from '@/lib/recipe';
import { cn } from '@/lib/utils';
import { formatAllocation } from '@/lib/pricing-format';
import type { Allocation } from '@/lib/pricing';
import type { NextOccurrenceView } from '@/lib/order-next-change-types';
import { NextChangeCard } from '@/components/orders/NextChangeCard';
import { NextChangeConflictSheet } from '@/components/orders/NextChangeConflictSheet';
import Link from 'next/link';

interface ScaledIngredient {
  name: string;
  kind: 'flour' | 'water' | 'salt' | 'starter' | 'other';
  grams: number;
  pctOfFlour: number;
  sortOrder: number;
}
interface ScaledRecipe {
  ingredients: ScaledIngredient[];
  totalFlourGrams: number;
  totalDoughGrams: number;
  finishedGrams: number;
}
interface OrderItem {
  id: number;
  breadTypeName: string;
  sizeName?: string | null;
  sizeWeightGrams?: number | null;
  additions?: { id: number; name: string }[];
  quantity: number;
  pricePerUnit: string | null;
  hasRecipe?: boolean;
  recipe?: ScaledRecipe | null;
}

interface OrderDetail {
  id: number;
  deliveryType: string;
  deliveryDate: string | null;
  status: string;
  paid: boolean;
  isRecurring?: boolean;
  notes: string | null;
  createdAt: string;
  customerName: string;
  customerId: number;
  customerPhoneCount: number;
  items: OrderItem[];
  totalQuantity: number;
  totalPrice: number;
  calculatedTotal: number;
  totalOverride: string | null;
  pricingBreakdown?: Allocation[] | null;
  isDelivery: boolean;
  deliveryFee: number;
  customerAddress: string | null;
  customerCity: string | null;
  customerDeliveryNotes: string | null;
  /** Whether this order's charge is already on the ledger the balance sums. */
  charged?: boolean;
  /** Money filed against this order: paid in advance while open, or at delivery. */
  paidAmount: number;
  /** Open recurring orders only: where the next one lands, and any change saved for it. */
  nextOccurrence?: NextOccurrenceView | null;
}

/**
 * What the price box opens on: the goods figure, which is what a custom price
 * replaces.
 *
 * It used to prefill order.totalPrice, which already has the delivery fee in it
 * — and the fee is then added to the override on the way back out. Saving the
 * pencil without touching the number grew a ₪220 delivery order to ₪240, then to
 * ₪260 on the next open, and the customer was charged it: the same total drives
 * the charge row. The order form has always sent the goods figure here.
 */
function goodsPriceInput(order: { totalOverride: string | null; calculatedTotal: number }): string {
  const goods = order.totalOverride != null ? Number(order.totalOverride) : order.calculatedTotal;
  return Number.isInteger(goods) ? String(goods) : goods.toFixed(2);
}

/** An amount as the box shows it: "120", or "99.50" when there are agorot. */
function amountInput(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// Forward actions only — the primary buttons. Reversals come from the shared
// state machine so the undo row and the server can never disagree about what
// is safe to walk back. Cancel stays on offer until delivery, as the server
// allows: a customer can still call it off after the bread is baked.
const statusActions: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['baking', 'ready', 'cancelled'],
  baking: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeGroupRole } = useGroup();
  const isAdmin = activeGroupRole === 'owner' || activeGroupRole === 'manager';
  const { apiFetch } = useApi();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [expandedRecipes, setExpandedRecipes] = useState<Set<number>>(new Set());

  const [showPriceEdit, setShowPriceEdit] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  const [showDeliveryPay, setShowDeliveryPay] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  // The part of the balance free to spend on an order: money paid ahead for an
  // order not yet delivered belongs to that order, not to "קזז מקרדיט".
  const [available, setAvailable] = useState<number | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [showPaymentInput, setShowPaymentInput] = useState(false);
  const [submittingPay, setSubmittingPay] = useState(false);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  // Paid in advance: the amount box under the total, and its two requests.
  const [showPrepay, setShowPrepay] = useState(false);
  const [prepayAmount, setPrepayAmount] = useState('');
  const [prepaying, setPrepaying] = useState(false);
  const [undoingPrepay, setUndoingPrepay] = useState(false);
  // Set after delivering a recurring order — the id of the auto-created next one.
  const [nextRecurringOrderId, setNextRecurringOrderId] = useState<number | null>(null);
  const [stoppingRecurring, setStoppingRecurring] = useState(false);
  const [discardingNext, setDiscardingNext] = useState(false);
  const [skipping, setSkipping] = useState(false);
  // A skip whose week was cancelled but whose next order wasn't made: the date
  // skipped. Kept on screen, since a toast would be the only trace of it.
  const [skipFailedDate, setSkipFailedDate] = useState<string | null>(null);
  // A custom price waiting on the "this week only, or from the next one too?"
  // question, when a planned change also sets the price. undefined = not asking.
  const [priceConflict, setPriceConflict] = useState<string | null | undefined>(undefined);
  // Drivers deliver but don't edit orders — nor plan their next occurrence.
  const canEdit = activeGroupRole !== 'driver';

  useEffect(() => {
    // Clear any prior "next recurring created" banner — the App Router reuses
    // this component instance across /orders/[id] navigations, so without this
    // the banner would follow you onto the freshly-created clone as a self-link.
    setNextRecurringOrderId(null);
    setSkipFailedDate(null);
    setShowPrepay(false);
    setBalance(null);
    setAvailable(null);
    apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
      .then((d) => {
        setOrder(d.order);
        if (d.order.status === 'delivered' || d.order.status === 'ready') {
          refreshBalance(d.order.customerId);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  /** The customer's balance, and how much of it is free to spend on an order. */
  function refreshBalance(customerId: number) {
    apiFetch<{ balance: string; available: string }>(`/customers/${customerId}/balance`)
      .then((b) => {
        setBalance(Number(b.balance));
        setAvailable(Number(b.available));
      })
      .catch(() => {});
  }

  async function updateStatus(status: string) {
    const willNotify = status === 'ready' || status === 'cancelled';
    let res: { nextRecurringOrderId?: number | null };
    try {
      res = await apiFetch<{ nextRecurringOrderId?: number | null }>(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(willNotify && { notifyCustomer }) }),
      });
    } catch (err) {
      toast.error(t('orders.update_failed'));
      throw err;
    }
    if (res.nextRecurringOrderId) setNextRecurringOrderId(res.nextRecurringOrderId);
    // A cancelled order's payment in advance becomes credit: it reads unpaid.
    setOrder((prev) => (prev ? { ...prev, status, ...(status === 'cancelled' ? { paid: false } : {}) } : prev));
    if (status === 'delivered' && order) {
      refreshBalance(order.customerId);
      // Delivery writes the charge, best-effort: ask rather than assume. A
      // charge is never taken back, so a late answer can only add it.
      apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
        .then((d) => setOrder((p) => (p ? { ...p, charged: p.charged || Boolean(d.order.charged) } : p)))
        .catch(() => {});
    }
  }

  /**
   * Cancelling a recurring order ends the repeat: no next order is made. Say
   * so, and point at skip, which is usually what was meant.
   */
  function cancelConfirmText(): string {
    if (!order) return t('orders.cancel_confirm');
    const lines = [t(order.isRecurring ? 'orders.cancel_recurring_confirm' : 'orders.cancel_confirm')];
    const skipDate = order.isRecurring && canEdit && order.nextOccurrence?.date ? order.deliveryDate : null;
    if (skipDate) {
      lines.push(t('orders.cancel_recurring_skip_hint').split('{date}').join(formatDayMonth(skipDate)));
    }
    // Money paid ahead isn't lost with the order: say where it goes.
    if (order.paidAmount > 0) {
      lines.push(t('orders.cancel_prepaid_hint').replace('{amount}', order.paidAmount.toFixed(0)));
    }
    return lines.join('\n\n');
  }

  async function handleStatusAction(status: string) {
    if (updating) return;
    if (status === 'cancelled' && !window.confirm(cancelConfirmText())) return;
    setUpdating(true);
    try {
      await updateStatus(status);
      toast.success(t('orders.updated'));
    } catch {
      // error toast already shown in updateStatus; optimistic state not applied
    } finally {
      setUpdating(false);
    }
  }

  async function handleDeliverClick() {
    if (!order || updating) return;
    // Paid in advance: nothing to ask at the door, so deliver straight away —
    // after a re-read, since an edit or an undo on another phone may have left
    // something due since this page loaded, and skipping the card would hand
    // the bread over without collecting it.
    if (order.paid) {
      setUpdating(true);
      let fresh: OrderDetail | null = null;
      try {
        fresh = (await apiFetch<{ order: OrderDetail }>(`/orders/${id}`)).order;
        setOrder(fresh);
      } catch {
        // Couldn't re-check: fall through to the card, which asks.
      }
      if (fresh?.paid && fresh.status === 'ready') {
        try {
          await updateStatus('delivered');
          toast.success(t('orders.updated'));
        } catch {
          // updateStatus already said it failed
        }
        setUpdating(false);
        return;
      }
      setUpdating(false);
      if (fresh && fresh.status !== 'ready') return;
    }
    // Always fresh: money may have moved since the page loaded, and the card
    // offers credit only on what is free right now.
    setAvailable(null);
    refreshBalance(order.customerId);
    setShowPrepay(false);
    setShowDeliveryPay(true);
  }

  async function handlePayAction(action: 'paid' | 'credit' | 'unpaid' | 'mark_paid', amount?: string) {
    if (!order) return;
    setSubmittingPay(true);
    try {
      if (order.status === 'ready') {
        await updateStatus('delivered');
      }
      const { balance: newBalance, paid, outcome } = await apiFetch<{
        balance: string;
        paid: boolean;
        outcome?: 'written' | 'duplicate' | 'already' | 'undone' | 'kept' | 'covered' | 'short' | 'none';
      }>(`/orders/${id}/pay`, { method: 'POST', body: JSON.stringify({ action, amount }) });
      setBalance(Number(newBalance));
      refreshBalance(order.customerId);
      // Every action but mark_paid writes the charge before it answers.
      setOrder((prev) =>
        prev ? { ...prev, status: 'delivered', paid, charged: prev.charged || action !== 'mark_paid' } : prev
      );
      setShowDeliveryPay(false);
      setShowPaymentInput(false);
      setPaymentAmount('');
      // The order already carries a payment row, so this amount was not stored.
      // Say it plainly — the ledger is short until it goes on the customer.
      if (outcome === 'already') toast.error(t('orders.payment_already'));
      else if (outcome === 'kept') toast.error(t('orders.payment_kept'));
      else if (outcome === 'covered') toast.error(t('orders.payment_covered'));
      else if (outcome === 'short') toast.error(t('orders.credit_short'));
      else if (outcome === 'undone') toast.success(t('orders.payment_undone'));
      else toast.success(action === 'unpaid' ? t('orders.charge_recorded') : t('orders.payment_recorded'));
    } catch {
      toast.error(t('orders.update_failed'));
    } finally {
      setSubmittingPay(false);
    }
  }

  async function handleStopRecurring() {
    if (stoppingRecurring) return;
    // Stopping drops a planned change too, so a slip of the finger would lose
    // it: ask, but only then — a plain stop stays one tap.
    const planned = order?.nextOccurrence?.change ? order.nextOccurrence.date : null;
    if (planned && !window.confirm(t('orders.stop_recurring_confirm').replace('{date}', formatDayMonth(planned)))) return;
    setStoppingRecurring(true);
    try {
      await apiFetch(`/orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isRecurring: false }),
      });
      setOrder((prev) => (prev ? { ...prev, isRecurring: false } : prev));
      toast.success(t('orders.recurring_stopped'));
    } catch {
      toast.error(t('orders.update_failed'));
    } finally {
      setStoppingRecurring(false);
    }
  }

  /** Cancel this week only: the server makes the next order at once. */
  async function handleSkip() {
    const occ = order?.nextOccurrence;
    if (skipping || !order?.deliveryDate || !occ?.date) return;
    const date = formatDayMonth(order.deliveryDate);
    const ask = t(occ.change ? 'orders.skip_confirm_planned' : 'orders.skip_confirm')
      .replace('{date}', date)
      .replace('{next}', formatDayMonth(occ.date));
    const prepaid =
      order.paidAmount > 0
        ? `\n\n${t('orders.skip_prepaid_hint')
            .replace('{amount}', order.paidAmount.toFixed(0))
            .replace('{next}', formatDayMonth(occ.date))}`
        : '';
    if (!window.confirm(ask + prepaid)) return;
    setSkipping(true);
    try {
      const res = await apiFetch<{ nextRecurringOrderId: number | null }>(`/orders/${id}/skip`, {
        method: 'POST',
      });
      // A paid week hands its money to the next order; otherwise it stays on
      // this one as the customer's credit.
      setOrder((prev) =>
        prev
          ? { ...prev, status: 'cancelled', paid: false, paidAmount: res.nextRecurringOrderId ? 0 : prev.paidAmount }
          : prev
      );
      if (res.nextRecurringOrderId) {
        setNextRecurringOrderId(res.nextRecurringOrderId);
        toast.success(t('orders.skipped').replace('{date}', date));
      } else {
        // The week is cancelled but the repeat didn't carry on: nothing else
        // would say so, and next week's bread would just never be ordered.
        setSkipFailedDate(date);
        toast.error(t('orders.skip_next_failed').replace('{date}', date));
      }
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        toast.error(t('orders.skip_too_late'));
        apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
          .then((d) => setOrder(d.order))
          .catch(() => {});
      } else {
        toast.error(t('orders.update_failed'));
      }
    } finally {
      setSkipping(false);
    }
  }

  async function handleDiscardNextChange() {
    const date = order?.nextOccurrence?.date;
    if (discardingNext || !date) return;
    if (!window.confirm(t('orders.next_change_discard_confirm').replace('{date}', formatDayMonth(date)))) return;
    setDiscardingNext(true);
    try {
      const { nextOccurrence } = await apiFetch<{ nextOccurrence: NextOccurrenceView | null }>(
        `/orders/${id}/next-change`,
        { method: 'DELETE' }
      );
      setOrder((prev) => (prev ? { ...prev, nextOccurrence } : prev));
      toast.success(t('orders.next_change_discarded'));
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        toast.error(t('orders.next_change_too_late'));
        // Someone else delivered or stopped it meanwhile: show what is true now.
        apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
          .then((d) => setOrder(d.order))
          .catch(() => {});
      } else {
        toast.error(t('orders.update_failed'));
      }
    } finally {
      setDiscardingNext(false);
    }
  }

  /** Paid before delivery: file it against the order. */
  async function handlePrepay(amount: string) {
    if (prepaying) return;
    setPrepaying(true);
    try {
      const res = await apiFetch<{
        outcome: 'written' | 'duplicate' | 'already' | 'none';
        paid: boolean;
        paidAmount: number;
      }>(`/orders/${id}/prepay`, { method: 'POST', body: JSON.stringify({ amount }) });
      setOrder((prev) => (prev ? { ...prev, paid: res.paid, paidAmount: res.paidAmount } : prev));
      if (order) refreshBalance(order.customerId);
      setShowPrepay(false);
      setPrepayAmount('');
      // Already holds a payment this one doesn't finish: it was not stored.
      if (res.outcome === 'already') toast.error(t('orders.prepay_already'));
      else toast.success(t('orders.prepay_recorded'));
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        toast.error(t('orders.prepay_too_late'));
        apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
          .then((d) => {
            setOrder(d.order);
            refreshBalance(d.order.customerId);
          })
          .catch(() => {});
      } else {
        toast.error(t('orders.update_failed'));
      }
    } finally {
      setPrepaying(false);
    }
  }

  /** Take back a payment in advance recorded by mistake. */
  async function handleUndoPrepay() {
    if (undoingPrepay || !order) return;
    if (!window.confirm(t('orders.prepay_undo_confirm').replace('{amount}', order.paidAmount.toFixed(0)))) return;
    setUndoingPrepay(true);
    try {
      await apiFetch(`/orders/${id}/prepay`, { method: 'DELETE' });
      setOrder((prev) => (prev ? { ...prev, paid: false, paidAmount: 0 } : prev));
      refreshBalance(order.customerId);
      toast.success(t('orders.prepay_undone'));
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        toast.error(t('orders.prepay_too_late'));
        apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
          .then((d) => {
            setOrder(d.order);
            refreshBalance(d.order.customerId);
          })
          .catch(() => {});
      } else {
        toast.error(t('orders.update_failed'));
      }
    } finally {
      setUndoingPrepay(false);
    }
  }

  /**
   * A planned change that sets the basket also sets the price of the orders
   * from its date, so a new price here asks the order form's question first:
   * this week only, or from then on too.
   */
  function handleSetPrice(override: string | null) {
    const planned = order?.isRecurring ? order.nextOccurrence?.change?.sections ?? [] : [];
    const current = order?.totalOverride ?? null;
    const changes =
      override == null || current == null ? override != current : Number(override) !== Number(current);
    if (changes && planned.includes('basket')) {
      setPriceConflict(override);
      return;
    }
    void savePrice(override);
  }

  async function savePrice(override: string | null, dropPlannedBasket = false) {
    setPriceConflict(undefined);
    setSavingPrice(true);
    try {
      await apiFetch(`/orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          totalOverride: override,
          ...(dropPlannedBasket ? { dropNextChange: ['basket'] } : {}),
        }),
      });
    } catch {
      toast.error(t('orders.update_failed'));
      setSavingPrice(false);
      return;
    }

    // Stored. What follows is a re-read, not the write — and it has to be its
    // own failure, because "העדכון נכשל" over a price that DID save leaves the
    // card showing the old total, which is then what the payment box prefills.
    //
    // Re-read rather than installing the PATCH's own row: that one carries no
    // phone count, no address block and no per-item weight or recipe, so
    // adopting it blanked the Waze link, the baker's recipe toggles and the
    // WhatsApp checkbox until the screen was reloaded.
    try {
      const { order: fresh } = await apiFetch<{ order: OrderDetail }>(`/orders/${id}`);
      setOrder(fresh);
      setShowPriceEdit(false);
      setPriceInput('');
    } catch {
      toast.error(t('orders.reload_failed'));
    } finally {
      setSavingPrice(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('orders.order_num')} />
        <div className="p-5 space-y-4">
          <div className="h-20 rounded-xl bg-muted animate-pulse" />
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
          <div className="h-24 rounded-xl bg-muted animate-pulse" />
        </div>
      </>
    );
  }

  if (!order) {
    return (
      <>
        <PageHeader title={t('orders.order_num')} />
        <div className="p-5 text-center text-muted-foreground">{t('general.not_found')}</div>
      </>
    );
  }

  const statusLabels: Record<string, string> = {
    pending: translate('status.pending', lang),
    confirmed: translate('status.confirmed', lang),
    baking: translate('status.baking', lang),
    ready: translate('status.ready', lang),
    delivered: translate('status.delivered', lang),
    cancelled: translate('status.cancelled', lang),
  };

  const actions = statusActions[order.status] || [];
  const reversals = ORDER_STATUS_REVERSALS[order.status] ?? [];
  const nonDeliverActions = actions.filter((s) => s !== 'delivered');
  const canDeliver = actions.includes('delivered');
  const isOpen = order.status !== 'delivered' && order.status !== 'cancelled';
  // Only an open recurring order carries a next occurrence (the API sends null
  // otherwise), so a stopped repeat hides its waiting change with the row.
  const nextOcc = order.isRecurring && isOpen ? order.nextOccurrence ?? null : null;
  const nextChange = nextOcc?.change ?? null;
  // What the order still needs after the money already filed against it.
  const due = Math.max(0, Math.round((order.totalPrice - order.paidAmount) * 100) / 100);
  // Credit is spent from the free balance only (`available`: money paid ahead
  // for an order not yet delivered is that order's, this one's included).
  // Once this order's charge is on the ledger the balance already accounts for
  // it, so asking for more than >= 0 asks the customer to cover it twice —
  // which hid the button from exactly the person who had prepaid. Keyed on the
  // charge itself rather than on the status: the charge is written best-effort
  // when the order is delivered, and if that write failed the balance in hand
  // is still the pre-charge one. An open order's own payments are held out of
  // `available`, so it needs only what is due; a delivered one's are back in
  // it, so without its charge it needs the whole total.
  const hasEnoughCredit =
    available !== null &&
    (order.charged ? available >= 0 : isOpen ? available >= due : available >= order.totalPrice);
  // Drivers collect at the door; they don't book money ahead. While the
  // deliver card is open it is the one place money is recorded.
  const prepayActions = isOpen && canEdit && !showDeliveryPay;
  const canPrepay = prepayActions && order.totalPrice > 0;

  function openPrepay() {
    setShowPriceEdit(false);
    setPrepayAmount(amountInput(due));
    setShowPrepay(true);
  }

  return (
    <>
      <PageHeader title={`${t('orders.order_num')} #${order.id}`} />
      <div className="p-5 space-y-4 animate-fade-in">
        {/* Status Flow */}
        <Card>
          <StatusFlow status={order.status} labels={statusLabels} />

          {/* Quietly subordinate to the forward buttons: this is a correction,
              not a step in the flow. Only appears where stepping back sends
              nothing and charges nothing. */}
          {reversals.length > 0 && (
            <div className="-mt-2 flex flex-wrap items-center justify-center gap-1 pb-1">
              <span className="text-xs text-muted-foreground">{t('orders.undo_to')}</span>
              {reversals.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="ghost"
                  disabled={updating}
                  onClick={() => handleStatusAction(s)}
                  className="h-8 gap-1 px-2 text-xs"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {translate(`status.${s}`, lang)}
                </Button>
              ))}
            </div>
          )}
        </Card>

        {/* Next recurring order — created just now on delivery, links to it */}
        {nextRecurringOrderId && (
          <Link href={`/miniapp/orders/${nextRecurringOrderId}`}>
            <Card className="border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors animate-expand">
              <div className="flex items-center gap-2.5">
                <Repeat className="h-4 w-4 text-primary shrink-0" />
                <span className="flex-1 text-sm font-medium">{t('orders.next_recurring_created')}</span>
                <span className="inline-flex items-center gap-0.5 font-mono text-sm font-bold text-primary tabular-nums">
                  #{nextRecurringOrderId}
                  <ChevronLeft className="h-4 w-4" />
                </span>
              </div>
            </Card>
          </Link>
        )}

        {skipFailedDate && (
          <Card className="border-destructive/30 bg-destructive/10">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm">{t('orders.skip_next_failed').replace('{date}', skipFailedDate)}</p>
            </div>
          </Card>
        )}

        {/* Details */}
        <Card>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">{t('form.customer')}</span>
              <Link
                href={`/miniapp/customers/${order.customerId}`}
                className="font-medium text-primary hover:underline"
              >
                {order.customerName}
              </Link>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">{t('form.delivery')}</span>
              <span className="font-medium inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {order.deliveryDate
                  ? formatDateRelative(order.deliveryDate, lang)
                  : translate(`delivery.${order.deliveryType}`, lang)}
              </span>
            </div>
            {order.isRecurring && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t('orders.recurring')}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    <Repeat className="h-3 w-3" />
                    {t('orders.repeat_weekly')}
                  </span>
                </div>
                {isOpen && (
                  <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs">
                    {/* Named by its date, not "next time": right after a
                        delivery the open order already IS next week's. */}
                    {canEdit && nextOcc?.plainDate && !nextChange && (
                      <>
                        <Link
                          href={`/miniapp/orders/new?edit=${order.id}&next=1`}
                          className="font-medium text-primary underline underline-offset-2"
                        >
                          {t('orders.next_change_link').replace('{date}', formatDayMonth(nextOcc.plainDate))}
                        </Link>
                        <span aria-hidden className="text-muted-foreground/60">·</span>
                      </>
                    )}
                    {canEdit && order.deliveryDate && nextOcc?.date && (
                      <>
                        <button
                          type="button"
                          onClick={handleSkip}
                          disabled={skipping}
                          className="font-medium text-primary underline underline-offset-2 disabled:opacity-50"
                        >
                          {t('orders.skip_link').replace('{date}', formatDayMonth(order.deliveryDate))}
                        </button>
                        <span aria-hidden className="text-muted-foreground/60">·</span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={handleStopRecurring}
                      disabled={stoppingRecurring}
                      className="text-muted-foreground underline underline-offset-2 hover:text-destructive transition-colors disabled:opacity-50"
                    >
                      {t('orders.stop_recurring')}
                    </button>
                  </div>
                )}
                {nextChange && nextOcc?.date && (
                  <NextChangeCard
                    view={nextOcc}
                    orderIsDelivery={order.isDelivery}
                    canEdit={canEdit}
                    editHref={`/miniapp/orders/new?edit=${order.id}&next=1`}
                    discarding={discardingNext}
                    onDiscard={handleDiscardNextChange}
                  />
                )}
              </div>
            )}
            {order.notes && (
              <div className="pt-2 border-t border-border">
                <span className="text-sm text-muted-foreground">{t('notify.notes')}</span>
                <p className="mt-1 text-sm">{order.notes}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Items */}
        <Card>
          <h3 className="font-semibold mb-3">פריטים</h3>
          <div className="space-y-2.5">
            {order.items.map((item) => {
              const isExpanded = expandedRecipes.has(item.id);
              return (
                <div key={item.id} className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {item.breadTypeName}
                        {item.sizeName && <span className="text-muted-foreground"> {item.sizeName}</span>}
                        {item.additions && item.additions.length > 0 && (
                          <span className="text-muted-foreground"> (עם {item.additions.map((a) => a.name).join(', ')})</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        ×{item.quantity}
                      </span>
                      {item.hasRecipe && item.recipe && (
                        <button
                          type="button"
                          aria-label={t('baker.show_recipe')}
                          title={t('baker.show_recipe')}
                          onClick={() =>
                            setExpandedRecipes((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                          className={cn(
                            'inline-flex items-center justify-center w-11 h-11 -m-2.5 text-muted-foreground hover:text-primary transition-colors',
                            isExpanded && 'text-primary'
                          )}
                        >
                          <ChefHat className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {item.pricePerUnit && (
                      <span className="text-sm text-muted-foreground tabular-nums">
                        ₪{(Number(item.pricePerUnit) * item.quantity).toFixed(0)}
                      </span>
                    )}
                  </div>
                  {isExpanded && item.recipe && (
                    <div className="text-xs bg-muted/40 rounded-md p-2 ms-2 space-y-2">
                      {groupByKind(item.recipe.ingredients).map((g) => (
                        <div key={g.kind} className="space-y-0.5">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            {t(`settings.kind_${g.kind}`)}
                          </div>
                          {g.items.map((ing, idx) => (
                            <div key={idx} className="flex justify-between gap-2">
                              <span>{ing.name}</span>
                              <span className="text-muted-foreground tabular-nums">
                                {Math.round(ing.grams)}ג
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                      <div className="pt-1 mt-1 border-t border-border/40 text-muted-foreground tabular-nums flex flex-wrap gap-x-3">
                        <span>{t('settings.finished_weight')}: {Math.round(item.recipe.finishedGrams)}ג</span>
                        <span>{t('settings.dough_total')}: {Math.round(item.recipe.totalDoughGrams)}ג</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {isAdmin && order.isDelivery && (
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
              <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <Truck className="h-4 w-4 text-primary" />
                {t('deliv.fee_label')}
              </span>
              <div className="flex items-center gap-3">
                {buildWazeLink(order.customerAddress, order.customerCity) && (
                  <a
                    href={buildWazeLink(order.customerAddress, order.customerCity)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary"
                  >
                    <Navigation className="h-4 w-4" />
                    {t('deliv.waze')}
                  </a>
                )}
                <span className="font-mono font-bold tabular-nums">
                  {order.deliveryFee > 0 ? `₪${order.deliveryFee.toFixed(0)}` : t('deliv.free')}
                </span>
              </div>
            </div>
          )}
          {order.pricingBreakdown && order.pricingBreakdown.some((r) => r.kind === 'pack') && (
            <div className="mt-4 pt-3 border-t border-border space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{t('order.price_breakdown')}</div>
              {order.pricingBreakdown.map((row, idx) => {
                const f = formatAllocation(row, t);
                return (
                  <div key={idx} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{f.label}</span>
                    <span className="font-mono tabular-nums">₪{f.amount}</span>
                  </div>
                );
              })}
            </div>
          )}
          {order.calculatedTotal > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <div className="flex justify-between items-center">
                <span className="font-bold">{t('orders.total')}</span>
                <div className="flex items-center gap-2">
                  {order.totalOverride ? (
                    <>
                      {/* Both figures include the delivery fee, or a ₪20 discount
                          on a ₪20-fee order struck ₪220 through and printed ₪220
                          beside it — the same goods-against-total mix-up the
                          price box carried. */}
                      <span className="line-through text-muted-foreground text-sm tabular-nums">
                        ₪{(order.calculatedTotal + order.deliveryFee).toFixed(0)}
                      </span>
                      <span className="font-bold text-lg tabular-nums">₪{order.totalPrice.toFixed(0)}</span>
                    </>
                  ) : (
                    <span className="font-bold text-lg tabular-nums">₪{order.totalPrice.toFixed(0)}</span>
                  )}
                  {order.status !== 'delivered' && order.status !== 'cancelled' && (
                    <button
                      className="inline-flex items-center justify-center w-11 h-11 -m-2.5 rounded hover:bg-muted transition-colors"
                      onClick={() => { setShowPrepay(false); setPriceInput(goodsPriceInput(order)); setShowPriceEdit(true); }}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
              {showPriceEdit && (
                <div className="mt-3 animate-expand">
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      className="flex-1"
                    />
                    <Button size="sm" disabled={!priceInput} loading={savingPrice} onClick={() => handleSetPrice(priceInput)}>
                      {t('settings.save')}
                    </Button>
                    {order.totalOverride && (
                      <Button size="sm" variant="ghost" disabled={savingPrice} onClick={() => handleSetPrice(null)}>✕</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setShowPriceEdit(false)}>
                      {t('payments.cancel')}
                    </Button>
                  </div>
                  {/* On a delivery order the box holds the goods, not the total —
                      say so, rather than leaving a number that looks ₪20 short. */}
                  {order.deliveryFee > 0 && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {t('orders.price_goods_hint')}
                    </p>
                  )}
                </div>
              )}

              {/* Paid in advance. Amounts on the start side, what can be done
                  with them on the end; a part-paid order gets a second row
                  for what is still due. */}
              {isOpen && order.paidAmount > 0 && (
                <div
                  className={cn(
                    'mt-3 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 text-sm',
                    order.paid ? 'bg-success/10' : 'bg-muted'
                  )}
                >
                  <span className={cn('inline-flex items-center gap-1.5 font-medium', order.paid && 'text-success')}>
                    {order.paid && <Check className="h-4 w-4 shrink-0" />}
                    {t('orders.prepaid').replace('{amount}', order.paidAmount.toFixed(0))}
                  </span>
                  {prepayActions ? (
                    <button
                      type="button"
                      onClick={handleUndoPrepay}
                      disabled={undoingPrepay}
                      className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-destructive disabled:opacity-50"
                    >
                      {t('payments.cancel')}
                    </button>
                  ) : (
                    <span />
                  )}
                  {!order.paid && due > 0 && (
                    <>
                      <span className="font-medium">{t('orders.prepaid_due').replace('{due}', due.toFixed(0))}</span>
                      {canPrepay && !showPrepay ? (
                        <button
                          type="button"
                          onClick={openPrepay}
                          className="text-xs font-medium text-primary underline underline-offset-2"
                        >
                          {`${t('payments.record')} ₪${due.toFixed(0)}`}
                        </button>
                      ) : (
                        <span />
                      )}
                    </>
                  )}
                </div>
              )}
              {canPrepay && order.paidAmount === 0 && !showPrepay && (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="outline" onClick={openPrepay}>
                    <Wallet className="h-4 w-4" />
                    {t('orders.prepay')}
                  </Button>
                </div>
              )}
              {canPrepay && showPrepay && (
                <div className="mt-3 flex gap-2 animate-expand">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={prepayAmount}
                    onChange={(e) => setPrepayAmount(e.target.value)}
                    aria-label={t('orders.prepay')}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={!(Number(prepayAmount) > 0)}
                    loading={prepaying}
                    onClick={() => handlePrepay(prepayAmount)}
                  >
                    {`${t('payments.record')} ₪${prepayAmount || '0'}`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowPrepay(false)}>
                    {t('payments.cancel')}
                  </Button>
                </div>
              )}
              {order.status === 'cancelled' && order.paidAmount > 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('orders.prepaid_to_credit').replace('{amount}', order.paidAmount.toFixed(0))}
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Edit button */}
        {order.status !== 'delivered' && order.status !== 'cancelled' && (
          <Link href={`/miniapp/orders/new?edit=${order.id}`}>
            <Button variant="outline" className="w-full">
              <Pencil className="h-4 w-4" />
              {t('orders.edit')}
            </Button>
          </Link>
        )}

        {/* Deliver button — first, so a ready order's cancel sits under it */}
        {canDeliver && !showDeliveryPay && (
          <Button className="w-full" size="lg" loading={updating} onClick={handleDeliverClick}>
            {translate('status.delivered', lang)}
          </Button>
        )}

        {/* Notify customer toggle (only when an action would send WA) */}
        {!showDeliveryPay && order.customerPhoneCount > 0 && (nonDeliverActions.includes('ready') || nonDeliverActions.includes('cancelled')) && (
          <label className="flex items-start gap-2.5 cursor-pointer p-2.5 rounded-lg hover:bg-muted/50 transition-colors -my-1">
            <input
              type="checkbox"
              checked={notifyCustomer}
              onChange={(e) => setNotifyCustomer(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
            />
            {/* Where cancel is the only action here that messages the
                customer, say so: under נמסר the plain label read as if
                delivering sent something. */}
            <span className="text-sm font-medium">
              {t(nonDeliverActions.includes('ready') ? 'notify.send_whatsapp' : 'notify.send_whatsapp_cancel')}
            </span>
          </label>
        )}

        {/* Status actions (non-deliver) */}
        {nonDeliverActions.length > 0 && !showDeliveryPay && (
          <div className="flex gap-2 flex-wrap">
            {nonDeliverActions.map((s) => (
              <Button
                key={s}
                variant={s === 'cancelled' ? 'danger' : 'primary'}
                className="flex-1"
                loading={updating}
                onClick={() => handleStatusAction(s)}
              >
                {translate(`status.${s}`, lang)}
              </Button>
            ))}
          </div>
        )}

        {/* Delivery payment flow */}
        {showDeliveryPay && order.status === 'ready' && (
          <Card className="border-primary/30 bg-primary/3 animate-expand">
            <h3 className="font-semibold mb-3">{t('orders.deliver_and_pay')}</h3>
            <PaymentOptions
              order={order}
              balance={available}
              due={due}
              hasEnoughCredit={hasEnoughCredit}
              showPaymentInput={showPaymentInput}
              paymentAmount={paymentAmount}
              submittingPay={submittingPay}
              t={t}
              onSetPaymentAmount={setPaymentAmount}
              onSetShowPaymentInput={setShowPaymentInput}
              onPayAction={handlePayAction}
            />
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2"
              onClick={() => { setShowDeliveryPay(false); setShowPaymentInput(false); }}
            >
              {t('payments.cancel')}
            </Button>
          </Card>
        )}

        {/* Persistent unpaid card */}
        {order.status === 'delivered' && !order.paid && order.totalPrice > 0 && (
          <Card className="border-amber-300/50 bg-amber-50/50">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold text-amber-800">
                {translate('status.to_be_paid', lang)}
              </h3>
            </div>
            <PaymentOptions
              order={order}
              balance={available}
              due={due}
              hasEnoughCredit={hasEnoughCredit}
              showPaymentInput={showPaymentInput}
              paymentAmount={paymentAmount}
              submittingPay={submittingPay}
              t={t}
              onSetPaymentAmount={setPaymentAmount}
              onSetShowPaymentInput={setShowPaymentInput}
              onPayAction={handlePayAction}
              showMarkPaid
            />
          </Card>
        )}

        {priceConflict !== undefined && (
          <NextChangeConflictSheet
            date={order.nextOccurrence?.date ? formatDayMonth(order.nextOccurrence.date) : null}
            sections={['basket']}
            onPick={(follow) => void savePrice(priceConflict, follow)}
            onClose={() => setPriceConflict(undefined)}
          />
        )}

        {/* Paid confirmation */}
        {order.status === 'delivered' && order.paid && balance !== null && (
          <Card className="border-success/30 bg-success/10">
            <div className="text-center text-sm">
              {balance === 0 ? (
                <span className="text-success font-medium">{t('customers.balance_square')}</span>
              ) : balance > 0 ? (
                <span className="text-success">{t('customers.balance_credit')}: ₪{balance.toFixed(0)}</span>
              ) : (
                <span className="text-destructive">{t('customers.balance_debt')}: ₪{Math.abs(balance).toFixed(0)}</span>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

/** Shared payment options UI used by both delivery flow and persistent unpaid card */
function PaymentOptions({
  order,
  balance,
  due,
  hasEnoughCredit,
  showPaymentInput,
  paymentAmount,
  submittingPay,
  t,
  onSetPaymentAmount,
  onSetShowPaymentInput,
  onPayAction,
  showMarkPaid,
}: {
  order: OrderDetail;
  /** The customer's balance free to spend: less money held by open orders. */
  balance: number | null;
  /** What the order still needs: the total less what was already paid on it. */
  due: number;
  hasEnoughCredit: boolean;
  showPaymentInput: boolean;
  paymentAmount: string;
  submittingPay: boolean;
  t: (key: string) => string;
  onSetPaymentAmount: (v: string) => void;
  onSetShowPaymentInput: (v: boolean) => void;
  onPayAction: (action: 'paid' | 'credit' | 'unpaid' | 'mark_paid', amount?: string) => void;
  showMarkPaid?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{t('orders.total')}</span>
        <span className="font-bold tabular-nums">₪{order.totalPrice.toFixed(0)}</span>
      </div>
      {order.paidAmount > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t('orders.paid_so_far')}</span>
          <span className="font-medium tabular-nums">₪{order.paidAmount.toFixed(0)}</span>
        </div>
      )}
      {balance !== null && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t('customers.balance')}</span>
          <span className={cn('font-medium tabular-nums', balance >= 0 ? 'text-success' : 'text-destructive')}>
            ₪{balance.toFixed(0)}
          </span>
        </div>
      )}

      {showPaymentInput ? (
        <div className="space-y-2">
          <Input
            type="number"
            inputMode="decimal"
            value={paymentAmount}
            onChange={(e) => onSetPaymentAmount(e.target.value)}
            placeholder={due.toFixed(0)}
          />
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!paymentAmount} loading={submittingPay} onClick={() => onPayAction('paid', paymentAmount)}>
              {`${t('payments.record')} ₪${paymentAmount || '0'}`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onSetShowPaymentInput(false)}>
              {t('payments.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          {hasEnoughCredit && (
            <Button className="flex-1" loading={submittingPay} onClick={() => onPayAction('credit')}>
              {t('orders.deduct_credit')}
            </Button>
          )}
          <Button
            className="flex-1"
            loading={submittingPay}
            onClick={() => { onSetPaymentAmount(amountInput(due)); onSetShowPaymentInput(true); }}
          >
            {t('orders.customer_paid')}
          </Button>
          {showMarkPaid ? (
            /* The caption belongs to this button, not to the row: the two
               actions look alike and are not — one records money and moves the
               balance, this one only stops the order asking. */
            <div className="flex flex-1 flex-col items-center gap-1">
              <Button
                variant="ghost"
                className="w-full"
                loading={submittingPay}
                onClick={() => onPayAction('mark_paid')}
              >
                {t('orders.mark_paid')}
              </Button>
              <span className="text-center text-[11px] leading-tight text-muted-foreground">
                {t('orders.mark_paid_hint')}
              </span>
            </div>
          ) : (
            <Button variant="danger" className="flex-1" loading={submittingPay} onClick={() => onPayAction('unpaid')}>
              {t('orders.not_yet_paid')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
