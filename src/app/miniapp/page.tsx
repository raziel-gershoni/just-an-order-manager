'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { formatHebrewDate } from '@/lib/date-utils';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useTelegram } from '@/components/providers/TelegramProvider';
import { useT, useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SectionHead } from '@/components/ui/SectionHead';
import { DocketRow } from '@/components/ui/DocketRow';
import { docketWidth } from '@/components/ui/DocketStub';
import { t as translate } from '@/lib/i18n';
import { groupByDeliveryDate } from '@/lib/order-grouping';
import { Plus, Banknote, Wheat, AlertTriangle, Clock } from 'lucide-react';
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
  const { activeGroupId, setActiveGroupId, setActiveGroupRole } = useGroup();
  const { user } = useTelegram();
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
      setActiveGroupRole('owner'); // the creator owns the bakery
      toast.success(t('dash.bakery_created'));
    } catch {
      toast.error(t('dash.bakery_create_failed'));
    } finally {
      setCreating(false);
    }
  }

  if (!activeGroupId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-8 animate-fade-in">
        <div className="w-full max-w-[320px]">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Wheat className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{t('dash.welcome')}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t('dash.welcome_sub')}</p>
          </div>
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-dashed border-border px-4 py-2.5">
              <span className="font-mono text-[10px] font-semibold tracking-widest text-primary">№ ····</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                DOCKET
              </span>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-sm font-semibold">{t('dash.create_group')}</label>
              <Input
                placeholder={t('dash.group_name')}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
              />
              <Button
                className="w-full"
                disabled={!groupName.trim()}
                loading={creating}
                onClick={handleCreateGroup}
              >
                {t('dash.create')}
              </Button>
            </div>
          </Card>
        </div>
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
  const maxTodayNo = todayOrders.length ? Math.max(...todayOrders.map((o) => o.id)) : 0;

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? t('dash.greeting_morning') : hour < 18 ? t('dash.greeting_afternoon') : t('dash.greeting_evening');
  const dateLabel = format(now, 'd בMMMM', { locale: he });
  const dayLabel = format(now, 'EEEE', { locale: he });
  const hebrewDate = formatHebrewDate(now);

  return (
    <div className="pb-6 animate-fade-in">
      {/* Top bar — greeting + docket date */}
      <header className="flex items-start justify-between px-5 pt-4 pb-2">
        <h1 className="text-xl font-extrabold tracking-tight">
          {greeting}
          {user?.firstName ? `, ${user.firstName}` : ''}
        </h1>
        <div className="text-end leading-tight">
          <div className="text-[12.5px] font-semibold text-muted-foreground">
            {dateLabel} · {hebrewDate}
          </div>
          <div className="text-[11px] font-semibold text-muted-foreground/70">{dayLabel}</div>
        </div>
      </header>

      {/* Hero docket — today's loaf count; hidden entirely when nothing today */}
      {todayOrders.length > 0 && (
        <section className="mx-4 mb-3 rounded-[8px] border border-border bg-card px-4 pb-3.5 pt-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold tracking-widest text-primary tabular-nums">
              № {String(maxTodayNo).padStart(4, '0')}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              DOCKET · יומי
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="whitespace-nowrap text-2xl font-extrabold tracking-tight">{t('dash.loaves_today')}</span>
            <span className="-translate-y-1.5 flex-1 border-b-2 border-dotted border-border" aria-hidden />
            <span className="font-display text-[52px] font-bold leading-none text-primary tabular-nums">
              {data?.totalPendingLoaves ?? 0}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--status-baking)' }} />
            <span>
              <span className="font-mono tabular-nums">{todayOrders.length}</span> {t('dash.active_orders')}
            </span>
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <div className="mx-4 grid grid-cols-2 gap-2.5">
        <Link
          href="/miniapp/orders/new"
          className="flex items-center gap-2.5 rounded-[8px] bg-primary px-4 py-3.5 text-[#F4EFE4] shadow-[0_2px_0_#43286b] transition-transform active:translate-y-px"
        >
          <Plus className="h-5 w-5" />
          <span className="font-bold">{t('dash.new_order')}</span>
        </Link>
        <Link
          href="/miniapp/payments"
          className="flex items-center gap-2.5 rounded-[8px] border border-border bg-card px-4 py-3.5 shadow-sm transition-transform active:translate-y-px"
        >
          <Banknote className="h-5 w-5 text-primary" />
          <span className="font-bold">{t('dash.record_payment')}</span>
        </Link>
      </div>

      {/* Pending triage chip */}
      {data?.pendingCount != null && data.pendingCount > 0 && (
        <div className="mx-4 mt-3">
          <Link href="/miniapp/orders" className="inline-flex">
            <span className="inline-flex items-center gap-2 rounded-[6px] bg-warning/10 px-3 py-2 text-sm font-bold text-warning">
              <Clock className="h-4 w-4" />
              ממתינות
              <span className="rounded-[4px] bg-warning px-1.5 py-0.5 font-mono text-xs text-white tabular-nums">
                {data.pendingCount}
              </span>
            </span>
          </Link>
        </div>
      )}

      {/* Nothing scheduled — compact hint (replaces the large empty-today block) */}
      {nothingScheduled && (
        <Card className="mx-4 mt-3 flex items-center gap-3 p-4">
          <Wheat className="h-5 w-5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground">{t('dash.no_scheduled_orders')}</span>
        </Card>
      )}

      {/* Today's Orders — hidden entirely when there's nothing today */}
      {todayOrders.length > 0 && (
        <>
          <SectionHead label={t('dash.today')} />
          <section className="mx-4 overflow-hidden rounded-[8px] border border-border bg-card shadow-sm">
            {todayOrders.map((o, idx) => (
              <DocketRow
                key={o.id}
                id={o.id}
                idWidth={schedW}
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
          </section>
        </>
      )}

      {/* Upcoming — each delivery date is its own section separator (no per-row date) */}
      {groupByDeliveryDate(upcomingOrders, lang).map((group) => (
        <div key={group.key}>
          <SectionHead label={group.label} loaves={group.loaves} />
          <section className="mx-4 overflow-hidden rounded-[8px] border border-border bg-card shadow-sm">
            {group.items.map((o, idx) => (
              <DocketRow
                key={o.id}
                id={o.id}
                idWidth={schedW}
                href={`/miniapp/orders/${o.id}`}
                primary={o.customerName}
                secondary={o.itemsSummary}
                status={o.status}
                statusLabel={translate(`status.${o.status}`, lang)}
                isRecurring={o.isRecurring}
                first={idx === 0}
              />
            ))}
          </section>
        </div>
      ))}

      {/* Debt alerts */}
      {data?.customersWithDebt && data.customersWithDebt.length > 0 && (
        <>
          <SectionHead label={t('dash.outstanding')} warn />
          <section className="mx-4 overflow-hidden rounded-[8px] border border-destructive/30 bg-destructive/5">
            {data.customersWithDebt.map((c, idx) => (
              <div
                key={c.customerId}
                className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-dashed border-destructive/15' : ''}`}
              >
                <Link href={`/miniapp/customers/${c.customerId}`} className="min-w-0 flex-1">
                  <div className="truncate font-bold">{c.customerName}</div>
                  <div className="text-[11px] font-bold tracking-wider text-destructive">לא שולם</div>
                </Link>
                <span className="font-mono text-lg font-bold tabular-nums text-destructive">
                  ₪{Math.abs(Number(c.balance)).toFixed(0)}
                </span>
                <Link
                  href={`/miniapp/payments?customerId=${c.customerId}`}
                  className="inline-flex items-center gap-1.5 rounded-[6px] bg-destructive px-3 py-2 text-[13px] font-bold text-[#F4EFE4] shadow-[0_2px_0_#8f2b20] transition-transform active:translate-y-px"
                >
                  <Banknote className="h-3.5 w-3.5" />
                  גבייה
                </Link>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
