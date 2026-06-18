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
import { t as translate } from '@/lib/i18n';
import { groupByDeliveryDate } from '@/lib/order-grouping';
import { DocketStub, docketWidth } from '@/components/ui/DocketStub';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { cn } from '@/lib/utils';
import { Plus, Banknote, Wheat, CalendarDays, AlertTriangle, Repeat, StickyNote, Clock } from 'lucide-react';
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
  const [error, setError] = useState(false);

  // Onboarding
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  function loadDashboard() {
    if (!activeGroupId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    apiFetch<DashboardData>('/dashboard')
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="h-[68px] rounded-xl bg-muted animate-pulse" />
          <div className="h-[68px] rounded-xl bg-muted animate-pulse" />
        </div>
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 animate-fade-in">
        <EmptyState
          icon={AlertTriangle}
          title="שגיאה בטעינת הנתונים"
          action={
            <Button variant="outline" size="sm" onClick={loadDashboard}>
              נסה שוב
            </Button>
          }
        />
      </div>
    );
  }

  const todayOrders = data?.todayOrders ?? [];
  const upcomingOrders = data?.upcomingOrders ?? [];
  const schedW = docketWidth([...todayOrders, ...upcomingOrders].map((o) => o.id));
  const nothingScheduled = todayOrders.length === 0 && upcomingOrders.length === 0;

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

      {/* Pending triage chip */}
      {data?.pendingCount != null && data.pendingCount > 0 && (
        <Link href="/miniapp/orders" className="block">
          <div className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-warning/10 text-warning font-medium text-sm">
            <Clock className="h-4 w-4 shrink-0" />
            ממתינות · {data.pendingCount}
          </div>
        </Link>
      )}

      {/* Nothing scheduled — compact hint (replaces the large empty-today block) */}
      {nothingScheduled && (
        <Card className="flex items-center gap-3 p-4">
          <Wheat className="h-5 w-5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground">{t('dash.no_scheduled_orders')}</span>
        </Card>
      )}

      {/* Today's Orders — hidden entirely when there's nothing today */}
      {todayOrders.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3">
            <h2 className="font-bold text-lg tracking-tight">{t('dash.today')}</h2>
            <span className="font-mono text-xs tabular-nums text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
              {data?.totalPendingLoaves ?? 0} {t('dash.loaves')}
            </span>
          </div>
          <div className="border-t border-dashed border-border">
            {todayOrders.map((o, idx) => {
              const displayStatus = o.status === 'delivered' && !o.paid ? 'to_be_paid' : o.status;
              return (
                <Link key={o.id} href={`/miniapp/orders/${o.id}`}>
                  <div className={cn(
                    'flex items-stretch transition-colors hover:bg-muted/40',
                    idx > 0 && 'border-t border-dashed border-border'
                  )}>
                    <DocketStub id={o.id} width={schedW} />
                    <div className="flex flex-1 items-center gap-3 px-3 py-3 min-w-0">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium flex items-center gap-1.5">
                          {o.isRecurring && <Repeat className="h-3 w-3 text-primary shrink-0" />}
                          <span className="truncate">{o.customerName}</span>
                          {o.notes && <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        </div>
                        <div className="text-sm text-muted-foreground line-clamp-1">{o.itemsSummary}</div>
                      </div>
                      <Badge status={displayStatus} label={translate(`status.${displayStatus}`, lang)} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {/* Upcoming — grouped by delivery date, date in the separator (not per row) */}
      {upcomingOrders.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3">
            <h2 className="font-bold text-lg tracking-tight flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              {t('dash.upcoming')}
            </h2>
          </div>
          {groupByDeliveryDate(upcomingOrders, lang).map((group) => (
            <div key={group.key}>
              <DateGroupHeader label={group.label} loaves={group.loaves} />
              {group.items.map((o, idx) => (
                <Link key={o.id} href={`/miniapp/orders/${o.id}`}>
                  <div className={cn(
                    'flex items-stretch transition-colors hover:bg-muted/40',
                    idx > 0 && 'border-t border-dashed border-border'
                  )}>
                    <DocketStub id={o.id} width={schedW} />
                    <div className="flex flex-1 items-center gap-3 px-3 py-3 min-w-0">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium flex items-center gap-1.5">
                          {o.isRecurring && <Repeat className="h-3 w-3 text-primary shrink-0" />}
                          <span className="truncate">{o.customerName}</span>
                        </div>
                        <div className="text-sm text-muted-foreground line-clamp-1">{o.itemsSummary}</div>
                      </div>
                      <Badge status={o.status} label={translate(`status.${o.status}`, lang)} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ))}
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
