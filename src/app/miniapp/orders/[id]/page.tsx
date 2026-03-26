'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useT, useLang } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusFlow } from '@/components/orders/StatusFlow';
import { formatDateRelative } from '@/lib/date-utils';
import { t as translate } from '@/lib/i18n';
import Link from 'next/link';

interface OrderDetail {
  id: number;
  quantity: number;
  deliveryType: string;
  deliveryDate: string | null;
  status: string;
  pricePerUnit: string | null;
  notes: string | null;
  createdAt: string;
  customerName: string;
  customerId: number;
  breadTypeName: string;
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
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
      .then((d) => setOrder(d.order))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function updateStatus(status: string) {
    await apiFetch(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setOrder((prev) => (prev ? { ...prev, status } : prev));
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
              <span className="opacity-60">{t('form.bread_type')}</span>
              <span className="font-medium">{order.breadTypeName}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-60">{t('form.quantity')}</span>
              <span className="font-medium">×{order.quantity}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-60">{t('form.delivery')}</span>
              <span className="font-medium">
                {order.deliveryDate
                  ? formatDateRelative(order.deliveryDate, lang)
                  : translate(`delivery.${order.deliveryType}`, lang)}
              </span>
            </div>
            {order.pricePerUnit && (
              <div className="flex justify-between">
                <span className="opacity-60">{t('settings.price')}</span>
                <span className="font-medium">₪{order.pricePerUnit}</span>
              </div>
            )}
            {order.notes && (
              <div>
                <span className="opacity-60">{t('notify.notes')}</span>
                <p className="mt-1">{order.notes}</p>
              </div>
            )}
          </div>
        </Card>

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

        {/* Charge prompt on delivery */}
        {order.status === 'delivered' && order.pricePerUnit && (
          <Card className="border border-yellow-200">
            <p className="text-sm mb-2">
              {t('orders.charge_prompt')} ₪
              {(Number(order.pricePerUnit) * order.quantity).toFixed(0)}{' '}
              {t('orders.for_this_order')}
            </p>
            <Link
              href={`/miniapp/payments?customerId=${order.customerId}&orderId=${order.id}&amount=${(Number(order.pricePerUnit) * order.quantity).toFixed(2)}`}
            >
              <Button size="sm" variant="secondary">
                {t('orders.record_charge')}
              </Button>
            </Link>
          </Card>
        )}
      </div>
    </>
  );
}
