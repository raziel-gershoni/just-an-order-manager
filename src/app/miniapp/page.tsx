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
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { formatDateRelative } from '@/lib/date-utils';
import { t as translate } from '@/lib/i18n';
import { Plus, Banknote, Wheat, CalendarDays, AlertTriangle, ChevronRight, ChevronLeft, Repeat } from 'lucide-react';
import Link from 'next/link';

interface DashboardData {
  todayOrders: {
    id: number;
    status: string;
    paid: boolean;
    isRecurring?: boolean;
    notes: string | null;
    customerName: string;
    totalQuantity: number;
    itemsSummary: string;
  }[];
  upcomingOrders: {
    id: number;
    deliveryDate: string | null;
    status: string;
    isRecurring?: boolean;
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

  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;

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
      <div className="p-6 space-y-6 animate-fade-in">
        <div className="text-center pt-8 pb-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Wheat className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('dash.welcome')}</h1>
        </div>
        <Card>
          <h3 className="font-semibold mb-3">{t('dash.create_group')}</h3>
          <div className="flex gap-2">
            <Input
              placeholder={t('dash.group_name')}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="flex-1"
            />
            <Button disabled={!groupName.trim()} loading={creating} onClick={handleCreateGroup}>
              {t('dash.create')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="h-14 rounded-xl bg-muted animate-pulse" />
          <div className="h-14 rounded-xl bg-muted animate-pulse" />
        </div>
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5 animate-fade-in">
      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/miniapp/orders/new">
          <Card className="flex items-center gap-3 p-3.5 hover:shadow-md cursor-pointer bg-primary/5 border-primary/15">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Plus className="h-5 w-5 text-primary" />
            </div>
            <span className="font-semibold text-sm">{t('dash.new_order')}</span>
          </Card>
        </Link>
        <Link href="/miniapp/payments">
          <Card className="flex items-center gap-3 p-3.5 hover:shadow-md cursor-pointer bg-secondary/50 border-secondary">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center shrink-0">
              <Banknote className="h-5 w-5 text-secondary-foreground" />
            </div>
            <span className="font-semibold text-sm">{t('dash.record_payment')}</span>
          </Card>
        </Link>
      </div>

      {/* Today's Orders */}
      <Card className="p-0 overflow-hidden">
        <div className="flex justify-between items-center p-4 pb-0">
          <h2 className="font-bold text-lg tracking-tight">{t('dash.today')}</h2>
          <span className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
            {data?.totalPendingLoaves ?? 0} {t('dash.loaves')}
          </span>
        </div>
        {data?.todayOrders.length === 0 ? (
          <EmptyState
            icon={Wheat}
            title={t('dash.no_orders_today')}
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
          <div className="px-4 pb-3 pt-3">
            <div className="divide-y divide-border">
              {data?.todayOrders.map((o) => {
                const displayStatus = o.status === 'delivered' && !o.paid ? 'to_be_paid' : o.status;
                return (
                  <Link
                    key={o.id}
                    href={`/miniapp/orders/${o.id}`}
                    className={`flex items-center justify-between py-3 ps-3 first:pt-0 last:pb-0 border-status-${displayStatus}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium flex items-center gap-1.5">
                        {o.isRecurring && <Repeat className="h-3 w-3 text-primary shrink-0" />}
                        {o.customerName}
                      </div>
                      <div className="text-sm text-muted-foreground">{o.itemsSummary}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ms-2">
                      <Badge status={displayStatus} label={translate(`status.${displayStatus}`, lang)} />
                      <Chevron className="h-4 w-4 text-muted-foreground/40" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Upcoming */}
      {data?.upcomingOrders && data.upcomingOrders.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="p-4 pb-0">
            <h2 className="font-bold text-lg tracking-tight flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              {t('dash.upcoming')}
            </h2>
          </div>
          <div className="px-4 pb-3 pt-3">
            <div className="divide-y divide-border">
              {data.upcomingOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/miniapp/orders/${o.id}`}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium inline-flex items-center gap-1.5">
                      {o.isRecurring && <Repeat className="h-3 w-3 text-primary shrink-0" />}
                      {o.customerName}
                    </span>
                    <span className="text-sm text-muted-foreground ms-2">{o.itemsSummary}</span>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0 ms-2">
                    {o.deliveryDate ? formatDateRelative(o.deliveryDate, lang) : ''}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Debt alerts */}
      {data?.customersWithDebt && data.customersWithDebt.length > 0 && (
        <Card className="border-destructive/20 bg-destructive/3 p-0 overflow-hidden">
          <div className="p-4 pb-0">
            <h2 className="font-bold text-lg tracking-tight flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('dash.outstanding')}
            </h2>
          </div>
          <div className="px-4 pb-3 pt-3">
            <div className="divide-y divide-destructive/10">
              {data.customersWithDebt.map((c) => (
                <Link
                  key={c.customerId}
                  href={`/miniapp/customers/${c.customerId}`}
                  className="flex justify-between items-center py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="font-medium">{c.customerName}</span>
                  <span className="font-bold text-destructive tabular-nums">
                    ₪{Math.abs(Number(c.balance)).toFixed(0)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
