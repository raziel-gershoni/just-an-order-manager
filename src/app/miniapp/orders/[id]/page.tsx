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
import { formatDateRelative } from '@/lib/date-utils';
import { t as translate } from '@/lib/i18n';
import { Calendar, Pencil, AlertTriangle, Repeat, ChefHat, Truck, Navigation } from 'lucide-react';
import { useGroup } from '@/hooks/useGroup';
import { buildWazeLink } from '@/lib/delivery';
import { groupByKind } from '@/lib/recipe';
import { cn } from '@/lib/utils';
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
  isDelivery: boolean;
  deliveryFee: number;
  customerAddress: string | null;
  customerCity: string | null;
  customerDeliveryNotes: string | null;
}

const statusActions: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['baking', 'ready', 'cancelled'],
  baking: ['ready'],
  ready: ['delivered'],
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
  const [paymentAmount, setPaymentAmount] = useState('');
  const [showPaymentInput, setShowPaymentInput] = useState(false);
  const [submittingPay, setSubmittingPay] = useState(false);
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  useEffect(() => {
    apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
      .then((d) => {
        setOrder(d.order);
        if (d.order.status === 'delivered' || d.order.status === 'ready') {
          apiFetch<{ balance: string }>(`/customers/${d.order.customerId}/balance`)
            .then((b) => setBalance(Number(b.balance)))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function updateStatus(status: string) {
    const willNotify = status === 'ready' || status === 'cancelled';
    try {
      await apiFetch(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(willNotify && { notifyCustomer }) }),
      });
    } catch (err) {
      toast.error(t('orders.update_failed'));
      throw err;
    }
    setOrder((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, status };
      if (status === 'delivered') {
        apiFetch<{ balance: string }>(`/customers/${prev.customerId}/balance`)
          .then((b) => setBalance(Number(b.balance)))
          .catch(() => {});
      }
      return updated;
    });
  }

  async function handleStatusAction(status: string) {
    if (updating) return;
    if (status === 'cancelled' && !window.confirm('לבטל את ההזמנה?')) return;
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

  function handleDeliverClick() {
    if (balance === null && order) {
      apiFetch<{ balance: string }>(`/customers/${order.customerId}/balance`)
        .then((b) => setBalance(Number(b.balance)))
        .catch(() => {});
    }
    setShowDeliveryPay(true);
  }

  async function handlePayAction(action: 'paid' | 'credit' | 'unpaid' | 'mark_paid', amount?: string) {
    if (!order) return;
    setSubmittingPay(true);
    try {
      if (order.status === 'ready') {
        await updateStatus('delivered');
      }
      const { balance: newBalance, paid } = await apiFetch<{ balance: string; paid: boolean }>(
        `/orders/${id}/pay`,
        { method: 'POST', body: JSON.stringify({ action, amount }) }
      );
      setBalance(Number(newBalance));
      setOrder((prev) => prev ? { ...prev, status: 'delivered', paid } : prev);
      setShowDeliveryPay(false);
      setShowPaymentInput(false);
      setPaymentAmount('');
      toast.success(action === 'unpaid' ? t('orders.charge_recorded') : t('orders.payment_recorded'));
    } catch {
      toast.error(t('orders.update_failed'));
    } finally {
      setSubmittingPay(false);
    }
  }

  async function handleSetPrice(override: string | null) {
    setSavingPrice(true);
    try {
      const { order: updated } = await apiFetch<{ order: OrderDetail }>(
        `/orders/${id}`,
        { method: 'PATCH', body: JSON.stringify({ totalOverride: override }) }
      );
      setOrder(updated);
      setShowPriceEdit(false);
      setPriceInput('');
    } catch {
      toast.error(t('orders.update_failed'));
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

  const hasEnoughCredit = balance !== null && balance >= order.totalPrice;
  const actions = statusActions[order.status] || [];
  const nonDeliverActions = actions.filter((s) => s !== 'delivered');
  const canDeliver = actions.includes('delivered');

  return (
    <>
      <PageHeader title={`${t('orders.order_num')} #${order.id}`} />
      <div className="p-5 space-y-4 animate-fade-in">
        {/* Status Flow */}
        <Card>
          <StatusFlow status={order.status} labels={statusLabels} />
        </Card>

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
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{t('orders.recurring')}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  <Repeat className="h-3 w-3" />
                  {t('orders.repeat_weekly')}
                </span>
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
          {order.calculatedTotal > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <div className="flex justify-between items-center">
                <span className="font-bold">{t('orders.total')}</span>
                <div className="flex items-center gap-2">
                  {order.totalOverride ? (
                    <>
                      <span className="line-through text-muted-foreground text-sm tabular-nums">
                        ₪{order.calculatedTotal.toFixed(0)}
                      </span>
                      <span className="font-bold text-lg tabular-nums">₪{order.totalPrice.toFixed(0)}</span>
                    </>
                  ) : (
                    <span className="font-bold text-lg tabular-nums">₪{order.totalPrice.toFixed(0)}</span>
                  )}
                  {order.status !== 'delivered' && order.status !== 'cancelled' && (
                    <button
                      className="inline-flex items-center justify-center w-11 h-11 -m-2.5 rounded hover:bg-muted transition-colors"
                      onClick={() => { setPriceInput(order.totalPrice.toFixed(0)); setShowPriceEdit(true); }}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
              {showPriceEdit && (
                <div className="flex gap-2 mt-3 animate-expand">
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

        {/* Notify customer toggle (only when an action would send WA) */}
        {!showDeliveryPay && order.customerPhoneCount > 0 && (nonDeliverActions.includes('ready') || nonDeliverActions.includes('cancelled')) && (
          <label className="flex items-start gap-2.5 cursor-pointer p-2.5 rounded-lg hover:bg-muted/50 transition-colors -my-1">
            <input
              type="checkbox"
              checked={notifyCustomer}
              onChange={(e) => setNotifyCustomer(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
            />
            <span className="text-sm font-medium">{t('notify.send_whatsapp')}</span>
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

        {/* Deliver button */}
        {canDeliver && !showDeliveryPay && (
          <Button className="w-full" size="lg" onClick={handleDeliverClick}>
            {translate('status.delivered', lang)}
          </Button>
        )}

        {/* Delivery payment flow */}
        {showDeliveryPay && order.status === 'ready' && (
          <Card className="border-primary/30 bg-primary/3 animate-expand">
            <h3 className="font-semibold mb-3">{t('orders.deliver_and_pay')}</h3>
            <PaymentOptions
              order={order}
              balance={balance}
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
              balance={balance}
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
  balance: number | null;
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
            placeholder={order.totalPrice.toFixed(0)}
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
        <div className="flex gap-2 flex-wrap">
          {hasEnoughCredit && (
            <Button className="flex-1" loading={submittingPay} onClick={() => onPayAction('credit')}>
              {t('orders.deduct_credit')}
            </Button>
          )}
          <Button
            className="flex-1"
            loading={submittingPay}
            onClick={() => { onSetPaymentAmount(order.totalPrice.toFixed(2)); onSetShowPaymentInput(true); }}
          >
            {t('orders.customer_paid')}
          </Button>
          {showMarkPaid ? (
            <Button variant="ghost" className="flex-1" loading={submittingPay} onClick={() => onPayAction('mark_paid')}>
              {t('orders.mark_paid')}
            </Button>
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
