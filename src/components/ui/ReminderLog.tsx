'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Check, X } from 'lucide-react';

type Occasion = 'week_start' | 'shabbat' | 'recurring';
type Status = 'sent' | 'failed';

interface SendRow {
  id: number;
  customerId: number;
  customerName: string;
  phone: string | null;
  templateLabel: string | null;
  occasion: Occasion;
  status: Status;
  sentAt: string;
}

const OCCASIONS: Occasion[] = ['recurring', 'week_start', 'shabbat'];
const PAGE = 50;

function fmt(sentAt: string): string {
  return new Date(sentAt).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReminderLog() {
  const { apiFetch } = useApi();
  const t = useT();
  const [rows, setRows] = useState<SendRow[]>([]);
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Monotonic request generation — bumped on every filter change so a response
  // from a superseded filter or an in-flight load-more is dropped instead of
  // clobbering the current list (out-of-order network responses).
  const genRef = useRef(0);

  function query(offset: number) {
    const p = new URLSearchParams();
    if (occasion) p.set('occasion', occasion);
    if (status) p.set('status', status);
    p.set('limit', String(PAGE));
    p.set('offset', String(offset));
    return apiFetch<{ sends: SendRow[]; hasMore: boolean }>(`/reminder-sends?${p}`);
  }

  useEffect(() => {
    const gen = ++genRef.current; // invalidate anything still in flight
    setLoading(true);
    query(0)
      .then((r) => {
        if (gen !== genRef.current) return; // a newer filter won
        setRows(r.sends);
        setHasMore(r.hasMore);
      })
      .catch(() => {
        if (gen !== genRef.current) return;
        setRows([]);
        setHasMore(false);
      })
      .finally(() => {
        if (gen === genRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occasion, status]);

  async function loadMore() {
    const gen = genRef.current; // tied to the current filter generation
    setLoadingMore(true);
    try {
      const r = await query(rows.length);
      if (gen !== genRef.current) return; // filter changed mid-request — drop it
      setRows((prev) => [...prev, ...r.sends]);
      setHasMore(r.hasMore);
    } catch {
      /* leave what we have */
    } finally {
      setLoadingMore(false);
    }
  }

  const chip = (active: boolean) =>
    'rounded-full border px-3 py-1 text-xs font-medium ' +
    (active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground');

  return (
    <div className="space-y-3">
      {/* Filters — occasion, then status */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chip(occasion === null)} onClick={() => setOccasion(null)}>
            {t('reminders.filter_all')}
          </button>
          {OCCASIONS.map((o) => (
            <button key={o} type="button" className={chip(occasion === o)} onClick={() => setOccasion(o)}>
              {t(`reminders.occasion.${o}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chip(status === null)} onClick={() => setStatus(null)}>
            {t('reminders.filter_all')}
          </button>
          <button type="button" className={chip(status === 'sent')} onClick={() => setStatus('sent')}>
            {t('reminders.status_sent')}
          </button>
          <button type="button" className={chip(status === 'failed')} onClick={() => setStatus('failed')}>
            {t('reminders.status_failed')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('reminders.log_empty')}</p>
      ) : (
        <Card className="p-0 overflow-hidden divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={
                  'grid h-6 w-6 flex-none place-items-center rounded-full ' +
                  (r.status === 'sent' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')
                }
                title={r.status === 'sent' ? t('reminders.status_sent') : t('reminders.status_failed')}
              >
                {r.status === 'sent' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">{r.customerName}</span>
                  <span className="flex-none rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t(`reminders.occasion.${r.occasion}`)}
                  </span>
                </div>
                {r.phone && (
                  <span className="block truncate text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {r.phone}
                  </span>
                )}
              </div>
              <span className="flex-none text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                {fmt(r.sentAt)}
              </span>
            </div>
          ))}
        </Card>
      )}

      {hasMore && !loading && (
        <Button variant="ghost" size="sm" className="w-full" loading={loadingMore} onClick={loadMore}>
          {t('reminders.load_more')}
        </Button>
      )}
    </div>
  );
}
