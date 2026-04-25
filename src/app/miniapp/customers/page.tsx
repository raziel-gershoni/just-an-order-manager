'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT, useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { Search, UserPlus, Users, ChevronRight, ChevronLeft, MessageCircle, X } from 'lucide-react';
import { getInitial } from '@/lib/name-utils';
import Link from 'next/link';

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  isActive: boolean;
}

export default function CustomersPage() {
  const { apiFetch } = useApi();
  const { activeGroupId } = useGroup();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;

  const customersWithPhone = customers.filter((c) => c.phone);

  async function sendOne(id: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (sendingId !== null) return;
    setSendingId(id);
    try {
      const res = await apiFetch<{ sent: number; failed: number }>('/customers/remind', {
        method: 'POST',
        body: JSON.stringify({ customerIds: [id] }),
      });
      if (res.sent > 0) toast.success(t('reminder.sent'));
      else toast.error(t('reminder.send_failed'));
    } catch {
      toast.error(t('reminder.send_failed'));
    } finally {
      setSendingId(null);
    }
  }

  async function sendBulk() {
    setSendingBulk(true);
    try {
      const res = await apiFetch<{ sent: number; failed: number; total: number }>(
        '/customers/remind',
        { method: 'POST', body: JSON.stringify({}) }
      );
      const msg = t('reminder.bulk_result')
        .replace('{sent}', String(res.sent))
        .replace('{total}', String(res.total));
      if (res.sent > 0) toast.success(msg);
      else toast.error(t('reminder.send_failed'));
      setShowBulkConfirm(false);
    } catch {
      toast.error(t('reminder.send_failed'));
    } finally {
      setSendingBulk(false);
    }
  }

  useEffect(() => {
    if (!activeGroupId) return;
    apiFetch<{ customers: Customer[] }>('/customers')
      .then((d) => setCustomers(d.customers))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId]);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const { customer } = await apiFetch<{ customer: Customer }>('/customers', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() }),
      });
      setCustomers((prev) => [...prev, customer].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setShowAdd(false);
      toast.success(t('customers.saved'));
    } catch {
      toast.error(t('customers.save_failed'));
    } finally {
      setAdding(false);
    }
  }

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-5 space-y-4 animate-fade-in">
      <div className="flex justify-between items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">{t('customers.title')}</h1>
        <div className="flex gap-2">
          {!showAdd && customersWithPhone.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowBulkConfirm(true)}
              className="text-emerald-700 hover:bg-emerald-50"
            >
              <MessageCircle className="h-4 w-4" />
              {t('reminder.send_all')}
            </Button>
          )}
          {!showAdd && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <UserPlus className="h-4 w-4" />
              {t('form.add_customer')}
            </Button>
          )}
        </div>
      </div>

      {showAdd && (
        <Card className="animate-expand">
          <div className="flex gap-2">
            <Input
              placeholder={t('form.customer_name')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
            />
            <Button size="sm" disabled={!newName.trim()} loading={adding} onClick={handleAdd}>
              {t('form.add')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); setNewName(''); }}>
              {t('payments.cancel')}
            </Button>
          </div>
        </Card>
      )}

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          className="w-full rounded-lg border border-input bg-card ps-9 pe-3 py-2.5 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground/50"
          placeholder={t('customers.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('customers.empty')}
          description={t('customers.empty_hint')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((c) => (
            <Link key={c.id} href={`/miniapp/customers/${c.id}`}>
              <Card className="flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {getInitial(c.name)}
                  </div>
                  <div className="min-w-0">
                    <span className="font-medium">{c.name}</span>
                    {c.phone && (
                      <span className="text-sm text-muted-foreground ms-2">{c.phone}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {c.phone && (
                    <button
                      onClick={(e) => sendOne(c.id, e)}
                      disabled={sendingId === c.id}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:animate-pulse"
                      aria-label={t('reminder.send')}
                    >
                      <MessageCircle className="h-4 w-4" />
                    </button>
                  )}
                  <Chevron className="h-4 w-4 text-muted-foreground/30" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {showBulkConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-fade-in"
          onClick={() => !sendingBulk && setShowBulkConfirm(false)}
        >
          <div
            className="w-full max-w-sm bg-card rounded-2xl shadow-xl animate-slide-down"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-4 pb-2">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <h2 className="font-bold">{t('reminder.bulk_confirm_title')}</h2>
              </div>
              <button
                onClick={() => !sendingBulk && setShowBulkConfirm(false)}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              {t('reminder.bulk_confirm_body').replace('{count}', String(customersWithPhone.length))}
            </p>
            <div className="flex gap-2 p-4 pt-0">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={sendingBulk}
                onClick={() => setShowBulkConfirm(false)}
              >
                {t('payments.cancel')}
              </Button>
              <Button
                className="flex-1"
                loading={sendingBulk}
                onClick={sendBulk}
              >
                {t('reminder.send')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
