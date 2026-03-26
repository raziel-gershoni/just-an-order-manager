'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT, useLang } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { t as translate } from '@/lib/i18n';
import { formatDateRelative } from '@/lib/date-utils';
import Link from 'next/link';
import { format, addDays } from 'date-fns';

interface Order {
  id: number;
  deliveryType: string;
  deliveryDate: string | null;
  status: string;
  notes: string | null;
  customerName: string;
  totalQuantity: number;
  itemsSummary: string;
}

type Tab = 'today' | 'week' | 'all';

export default function OrdersPage() {
  const { apiFetch } = useApi();
  const { activeGroupId } = useGroup();
  const t = useT();
  const lang = useLang();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('today');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!activeGroupId) return;
    setLoading(true);
    const params = new URLSearchParams();

    if (tab === 'today') {
      const today = format(new Date(), 'yyyy-MM-dd');
      params.set('dateFrom', today);
      params.set('dateTo', today);
    } else if (tab === 'week') {
      params.set('dateFrom', format(new Date(), 'yyyy-MM-dd'));
      params.set('dateTo', format(addDays(new Date(), 7), 'yyyy-MM-dd'));
    }

    apiFetch<{ orders: Order[] }>(`/orders?${params}`)
      .then((d) => setOrders(d.orders))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId, tab]);

  async function updateStatus(orderId: number, status: string) {
    await apiFetch(`/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status } : o))
    );
  }

  const statusActions: Record<string, string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['baking', 'cancelled'],
    baking: ['ready'],
    ready: ['delivered'],
  };

  const tabLabels: Record<Tab, string> = {
    today: t('orders.tab_today'),
    week: t('orders.tab_week'),
    all: t('orders.tab_all'),
  };

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('orders.title')}</h1>
        <Link href="/miniapp/orders/new">
          <Button size="sm">+ {t('orders.new')}</Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['today', 'week', 'all'] as const).map((tabKey) => (
          <button
            key={tabKey}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === tabKey
                ? 'bg-[var(--tg-theme-button-color,#3b82f6)] text-[var(--tg-theme-button-text-color,#fff)]'
                : 'bg-black/5'
            }`}
            onClick={() => setTab(tabKey)}
          >
            {tabLabels[tabKey]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center opacity-50 py-8">{t('general.loading')}</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium opacity-70">{t('orders.empty')}</p>
          <p className="text-sm opacity-40 mt-1">{t('orders.empty_hint')}</p>
          <Link href="/miniapp/orders/new">
            <Button variant="secondary" size="sm" className="mt-4">
              + {t('dash.new_order')}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Card
              key={o.id}
              className={`cursor-pointer border-status-${o.status}`}
              onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{o.customerName}</span>
                  <span className="text-sm opacity-60 ms-1.5">{o.itemsSummary}</span>
                </div>
                <div className="flex items-center gap-2">
                  {o.deliveryDate && (
                    <span className="text-xs opacity-50">
                      {formatDateRelative(o.deliveryDate, lang)}
                    </span>
                  )}
                  <Badge status={o.status} label={translate(`status.${o.status}`, lang)} />
                </div>
              </div>

              {expandedId === o.id && (
                <div className="mt-3 pt-3 border-t border-black/10 space-y-2 animate-expand">
                  {o.notes && <p className="text-sm opacity-60">{o.notes}</p>}
                  <div className="flex gap-2 flex-wrap">
                    {statusActions[o.status]?.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={s === 'cancelled' ? 'danger' : 'secondary'}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateStatus(o.id, s);
                        }}
                      >
                        {translate(`status.${s}`, lang)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
