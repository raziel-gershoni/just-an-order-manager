'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT, useLang } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t as translate } from '@/lib/i18n';
import { groupByDeliveryDate } from '@/lib/order-grouping';
import { Plus, ClipboardList, AlertCircle, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { docketWidth } from '@/components/ui/DocketStub';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { DocketRow } from '@/components/ui/DocketRow';
import Link from 'next/link';

interface Order {
  id: number;
  deliveryType: string;
  deliveryDate: string | null;
  status: string;
  paid: boolean;
  isRecurring?: boolean;
  notes: string | null;
  customerName: string;
  totalQuantity: number;
  itemsSummary: string;
}

type Tab = 'active' | 'completed' | 'all';

export default function OrdersPage() {
  const { apiFetch } = useApi();
  const { activeGroupId } = useGroup();
  const t = useT();
  const lang = useLang();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>('active');

  useEffect(() => {
    if (!activeGroupId) return;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();

    if (tab === 'active') {
      params.set('active', 'true');
    } else if (tab === 'completed') {
      params.set('status', 'delivered');
    }

    apiFetch<{ orders: Order[] }>(`/orders?${params}`)
      .then((d) => setOrders(d.orders))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [activeGroupId, tab, reloadKey]);

  const tabLabels: Record<Tab, string> = {
    active: t('orders.tab_active'),
    completed: t('orders.tab_completed'),
    all: t('orders.tab_all'),
  };

  const idW = docketWidth(orders.map((o) => o.id));

  return (
    <div className="p-5 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">{t('orders.title')}</h1>
        <Link href="/miniapp/orders/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            {t('orders.new')}
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg">
        {(['active', 'completed', 'all'] as const).map((tabKey) => (
          <button
            key={tabKey}
            className={cn(
              'flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all',
              tab === tabKey
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setTab(tabKey)}
          >
            {tabLabels[tabKey]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-7 w-7 text-destructive" />
          </div>
          <h3 className="font-semibold text-foreground mb-1">{t('orders.update_failed')}</h3>
          <p className="text-sm text-muted-foreground max-w-[240px]">
            טעינת ההזמנות נכשלה. בדקו את החיבור ונסו שוב.
          </p>
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              loading={loading}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RotateCw className="h-4 w-4" />
              נסו שוב
            </Button>
          </div>
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={tab === 'completed' ? 'אין הזמנות שהושלמו' : t('orders.empty')}
          description={tab === 'completed' ? undefined : t('orders.empty_hint')}
          action={
            tab === 'completed' ? undefined : (
              <Link href="/miniapp/orders/new">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" />
                  {t('dash.new_order')}
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {groupByDeliveryDate(orders, lang).map((group) => (
            <div key={group.key}>
              <DateGroupHeader label={group.label} loaves={group.loaves} />
              {group.items.map((o, idx) => (
                <DocketRow
                  key={o.id}
                  id={o.id}
                  idWidth={idW}
                  href={`/miniapp/orders/${o.id}`}
                  primary={o.customerName}
                  secondary={o.itemsSummary}
                  status={o.status}
                  statusLabel={translate(`status.${o.status}`, lang)}
                  paid={o.paid}
                  showPay
                  isRecurring={o.isRecurring}
                  hasNotes={!!o.notes}
                  first={idx === 0}
                />
              ))}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
