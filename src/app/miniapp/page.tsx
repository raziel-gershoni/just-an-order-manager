'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatDateRelative } from '@/lib/date-utils';
import { t as translate } from '@/lib/i18n';
import Link from 'next/link';

interface DashboardData {
  todayOrders: {
    id: number;
    status: string;
    notes: string | null;
    customerName: string;
    totalQuantity: number;
    itemsSummary: string;
  }[];
  upcomingOrders: {
    id: number;
    deliveryDate: string | null;
    status: string;
    customerName: string;
    totalQuantity: number;
    itemsSummary: string;
  }[];
  pendingCount: number;
  customersWithDebt: {
    customerId: number;
    customerName: string;
    balance: string;
  }[];
  totalPendingLoaves: number;
}

export default function Dashboard() {
  const { apiFetch } = useApi();
  const { activeGroupId, setActiveGroupId } = useGroup();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Onboarding
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!activeGroupId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<DashboardData>('/dashboard')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId]);

  async function handleCreateGroup() {
    if (!groupName.trim()) return;
    setCreating(true);
    try {
      const { group } = await apiFetch<{ group: { id: number } }>('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName.trim() }),
      });
      setActiveGroupId(group.id);
      toast.success(t('orders.created'));
    } catch {
      toast.error(t('orders.create_failed'));
    } finally {
      setCreating(false);
    }
  }

  if (!activeGroupId) {
    return (
      <div className="p-4 space-y-4 animate-fade-in">
        <h1 className="text-xl font-bold text-center">{t('dash.welcome')}</h1>
        <Card>
          <h3 className="font-medium mb-3">{t('dash.create_group')}</h3>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-black/10 bg-[var(--tg-theme-bg-color,#ffffff)] px-3 py-2 text-base outline-none"
              placeholder={t('dash.group_name')}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <Button disabled={!groupName.trim() || creating} onClick={handleCreateGroup}>
              {creating ? '...' : t('dash.create')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="p-4 text-center opacity-50">{t('general.loading')}</div>;
  }

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/miniapp/orders/new">
          <Button className="w-full" size="lg">
            + {t('dash.new_order')}
          </Button>
        </Link>
        <Link href="/miniapp/payments">
          <Button variant="secondary" className="w-full" size="lg">
            {t('dash.record_payment')}
          </Button>
        </Link>
      </div>

      {/* Today's Orders */}
      <Card>
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold text-lg">{t('dash.today')}</h2>
          <span className="text-sm opacity-60">
            {data?.totalPendingLoaves ?? 0} {t('dash.loaves')}
          </span>
        </div>
        {data?.todayOrders.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-3xl mb-2">🍞</p>
            <p className="text-sm opacity-50">{t('dash.no_orders_today')}</p>
            <Link href="/miniapp/orders/new">
              <Button variant="ghost" size="sm" className="mt-2">
                + {t('dash.new_order')}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {data?.todayOrders.map((o) => (
              <Link
                key={o.id}
                href={`/miniapp/orders/${o.id}`}
                className={`flex items-center justify-between py-2 px-3 rounded-lg border-status-${o.status}`}
              >
                <div>
                  <span className="font-medium">{o.customerName}</span>
                  <span className="text-sm opacity-60 ms-1.5">{o.itemsSummary}</span>
                </div>
                <Badge status={o.status} label={translate(`status.${o.status}`, lang)} />
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Upcoming */}
      {data?.upcomingOrders && data.upcomingOrders.length > 0 && (
        <Card>
          <h2 className="font-bold text-lg mb-3">{t('dash.upcoming')}</h2>
          <div className="space-y-2">
            {data.upcomingOrders.map((o) => (
              <Link
                key={o.id}
                href={`/miniapp/orders/${o.id}`}
                className="flex items-center justify-between py-1"
              >
                <div>
                  <span className="font-medium">{o.customerName}</span>
                  <span className="text-sm opacity-60 ms-1.5">{o.itemsSummary}</span>
                </div>
                <span className="text-xs opacity-50">
                  {o.deliveryDate ? formatDateRelative(o.deliveryDate, lang) : ''}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Debt alerts */}
      {data?.customersWithDebt && data.customersWithDebt.length > 0 && (
        <Card className="border border-red-200">
          <h2 className="font-bold text-lg mb-3 text-red-600">{t('dash.outstanding')}</h2>
          <div className="space-y-1">
            {data.customersWithDebt.map((c) => (
              <Link
                key={c.customerId}
                href={`/miniapp/customers/${c.customerId}`}
                className="flex justify-between py-1"
              >
                <span>{c.customerName}</span>
                <span className="text-red-600 font-medium">
                  ₪{Math.abs(Number(c.balance)).toFixed(0)}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
