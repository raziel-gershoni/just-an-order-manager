'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT, useLang } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t as translate } from '@/lib/i18n';
import { formatDateRelative } from '@/lib/date-utils';
import { Plus, ClipboardList, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface Order {
  id: number;
  deliveryType: string;
  deliveryDate: string | null;
  status: string;
  paid: boolean;
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
  const [tab, setTab] = useState<Tab>('active');

  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;

  useEffect(() => {
    if (!activeGroupId) return;
    setLoading(true);
    const params = new URLSearchParams();

    if (tab === 'active') {
      params.set('active', 'true');
    } else if (tab === 'completed') {
      params.set('status', 'delivered');
    }

    apiFetch<{ orders: Order[] }>(`/orders?${params}`)
      .then((d) => setOrders(d.orders))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId, tab]);

  const tabLabels: Record<Tab, string> = {
    active: t('orders.tab_active'),
    completed: t('orders.tab_completed'),
    all: t('orders.tab_all'),
  };

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
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t('orders.empty')}
          description={t('orders.empty_hint')}
          action={
            <Link href="/miniapp/orders/new">
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                {t('dash.new_order')}
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((o) => {
            const displayStatus = o.status === 'delivered' && !o.paid ? 'to_be_paid' : o.status;
            return (
              <Link key={o.id} href={`/miniapp/orders/${o.id}`}>
                <Card className={cn(
                  'hover:shadow-md transition-shadow cursor-pointer ps-5 border-status-' + displayStatus
                )}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{o.customerName}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">{o.itemsSummary}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-col items-end gap-1">
                        <Badge status={displayStatus} label={translate(`status.${displayStatus}`, lang)} />
                        {o.deliveryDate && (
                          <span className="text-xs text-muted-foreground">
                            {formatDateRelative(o.deliveryDate, lang)}
                          </span>
                        )}
                      </div>
                      <Chevron className="h-4 w-4 text-muted-foreground/30" />
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
