'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useT, useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusFlow } from '@/components/orders/StatusFlow';
import { formatDateRelative } from '@/lib/date-utils';
import { t as translate } from '@/lib/i18n';
import Link from 'next/link';

interface OrderItem {
  id: number;
  breadTypeName: string;
  quantity: number;
  pricePerUnit: string | null;
}

interface OrderDetail {
  id: number;
  deliveryType: string;
  deliveryDate: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  customerName: string;
  customerId: number;
  items: OrderItem[];
  totalQuantity: number;
  totalPrice: number;
  calculatedTotal: number;
  totalOverride: string | null;
}

const statusActions: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['baking', 'cancelled'],
  baking: ['ready'],
  ready: ['delivered'],
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiFetch } = useApi();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Price override state
  const [showPriceEdit, setShowPriceEdit] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  // Payment flow state
  const [balance, setBalance] = useState<number | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [showPaymentInput, setShowPaymentInput] = useState(false);
  const [submittingPay, setSubmittingPay] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);

  useEffect(() => {
    apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
      .then((d) => {
        setOrder(d.order);
        // Fetch balance for delivered orders
        if (d.order.status === 'delivered') {
          apiFetch<{ balance: string }>(`/customers/${d.order.customerId}/balance`)
            .then((b) => setBalance(Number(b.balance)))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function updateStatus(status: string) {
    await apiFetch(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setOrder((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, status };
      // Fetch balance when marking as delivered
      if (status === 'delivered') {
        apiFetch<{ balance: string }>(`/customers/${prev.customerId}/balance`)
          .then((b) => setBalance(Number(b.balance)))
          .catch(() => {});
      }
      return updated;
    });
  }

  async function handlePay(paid: boolean, amount?: string) {
    setSubmittingPay(true);
    try {
      const { balance: newBalance } = await apiFetch<{ balance: string }>(
        `/orders/${id}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({ paid, amount }),
        }
      );
      setBalance(Number(newBalance));
      setPaymentDone(true);
      toast.success(paid ? t('orders.payment_recorded') : t('orders.charge_recorded'));
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
        {
          method: 'PATCH',
          body: JSON.stringify({ totalOverride: override }),
        }
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
        <div className="p-4 text-center opacity-50">{t('general.loading')}</div>
      </>
    );
  }

  if (!order) {
    return (
      <>
        <PageHeader title={t('orders.order_num')} />
        <div className="p-4 text-center">{t('general.not_found')}</div>
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

  // Check if charge already exists (payment flow already completed)
  const hasEnoughCredit = balance !== null && balance >= order.totalPrice;

  return (
    <>
      <PageHeader title={`${t('orders.order_num')} #${order.id}`} />
      <div className="p-4 space-y-4 animate-fade-in">
        {/* Status Flow */}
        <Card>
          <StatusFlow status={order.status} labels={statusLabels} />
        </Card>

        {/* Details */}
        <Card>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="opacity-60">{t('form.customer')}</span>
              <Link
                href={`/miniapp/customers/${order.customerId}`}
                className="font-medium underline"
              >
                {order.customerName}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="opacity-60">{t('form.delivery')}</span>
              <span className="font-medium">
                {order.deliveryDate
                  ? formatDateRelative(order.deliveryDate, lang)
                  : translate(`delivery.${order.deliveryType}`, lang)}
              </span>
            </div>
            {order.notes && (
              <div>
                <span className="opacity-60">{t('notify.notes')}</span>
                <p className="mt-1">{order.notes}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Items */}
        <Card>
          <h3 className="font-medium mb-2">{t('form.bread_type')}</h3>
          <div className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between items-center">
                <div>
                  <span className="font-medium">{item.breadTypeName}</span>
                  <span className="text-xs opacity-50 mx-1.5">×{item.quantity}</span>
                </div>
                {item.pricePerUnit && (
                  <span className="opacity-60">
                    ₪{(Number(item.pricePerUnit) * item.quantity).toFixed(0)}
                  </span>
                )}
              </div>
            ))}
          </div>
          {order.calculatedTotal > 0 && (
            <div className="mt-3 pt-3 border-t border-black/10">
              <div className="flex justify-between items-center font-bold">
                <span>{t('orders.total')}</span>
                <div className="flex items-center gap-2">
                  {order.totalOverride ? (
                    <>
                      <span className="line-through opacity-40 font-normal text-sm">
                        ₪{order.calculatedTotal.toFixed(0)}
                      </span>
                      <span>₪{order.totalPrice.toFixed(0)}</span>
                    </>
                  ) : (
                    <span>₪{order.totalPrice.toFixed(0)}</span>
                  )}
                  {order.status !== 'delivered' && order.status !== 'cancelled' && (
                    <button
                      className="text-xs opacity-50 underline font-normal"
                      onClick={() => {
                        setPriceInput(order.totalPrice.toFixed(0));
                        setShowPriceEdit(true);
                      }}
                    >
                      {t('settings.edit')}
                    </button>
                  )}
                </div>
              </div>
              {showPriceEdit && (
                <div className="flex gap-2 mt-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={!priceInput || savingPrice}
                    onClick={() => handleSetPrice(priceInput)}
                  >
                    {savingPrice ? '...' : t('settings.save')}
                  </Button>
                  {order.totalOverride && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={savingPrice}
                      onClick={() => handleSetPrice(null)}
                    >
                      ✕
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPriceEdit(false)}
                  >
                    {t('payments.cancel')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Edit button - only for pending orders */}
        {order.status !== 'delivered' && order.status !== 'cancelled' && (
          <Link href={`/miniapp/orders/new?edit=${order.id}`}>
            <Button variant="secondary" className="w-full">
              {t('orders.edit')}
            </Button>
          </Link>
        )}

        {/* Status actions */}
        {statusActions[order.status] && (
          <div className="flex gap-2 flex-wrap">
            {statusActions[order.status].map((s) => (
              <Button
                key={s}
                variant={s === 'cancelled' ? 'danger' : 'primary'}
                className="flex-1"
                onClick={() => updateStatus(s)}
              >
                {translate(`status.${s}`, lang)}
              </Button>
            ))}
          </div>
        )}

        {/* Payment flow on delivery */}
        {order.status === 'delivered' && order.totalPrice > 0 && !paymentDone && (
          <Card className="border border-yellow-200">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>{t('orders.total')}</span>
                <span className="font-bold">₪{order.totalPrice.toFixed(0)}</span>
              </div>
              {balance !== null && (
                <div className="flex justify-between text-sm">
                  <span>{t('customers.balance')}</span>
                  <span className={balance >= 0 ? 'text-green-600' : 'text-red-600'}>
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
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder={order.totalPrice.toFixed(0)}
                  />
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={!paymentAmount || submittingPay}
                      onClick={() => handlePay(true, paymentAmount)}
                    >
                      {submittingPay ? '...' : `${t('payments.record')} ₪${paymentAmount || '0'}`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPaymentInput(false)}
                    >
                      {t('payments.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {hasEnoughCredit ? (
                    <Button
                      className="flex-1"
                      disabled={submittingPay}
                      onClick={() => handlePay(false)}
                    >
                      {t('orders.deduct_credit')}
                    </Button>
                  ) : (
                    <Button
                      className="flex-1"
                      disabled={submittingPay}
                      onClick={() => {
                        setPaymentAmount(order.totalPrice.toFixed(2));
                        setShowPaymentInput(true);
                      }}
                    >
                      {t('orders.customer_paid')}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    className="flex-1"
                    disabled={submittingPay}
                    onClick={() => handlePay(false)}
                  >
                    {t('orders.not_yet_paid')}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Payment done confirmation */}
        {paymentDone && balance !== null && (
          <Card className="border border-green-200">
            <div className="text-center text-sm">
              {balance === 0 ? (
                <span className="text-green-600 font-medium">{t('customers.balance_square')}</span>
              ) : balance > 0 ? (
                <span className="text-green-600">{t('customers.balance_credit')}: ₪{balance.toFixed(0)}</span>
              ) : (
                <span className="text-red-600">{t('customers.balance_debt')}: ₪{Math.abs(balance).toFixed(0)}</span>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
