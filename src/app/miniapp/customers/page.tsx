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
import { SendReminderSheet } from '@/components/ui/SendReminderSheet';
import { Search, UserPlus, Users, ChevronRight, ChevronLeft, SearchX, AlertCircle, CheckSquare, Send } from 'lucide-react';
import { getInitial } from '@/lib/name-utils';
import { DocketStub, docketWidth } from '@/components/ui/DocketStub';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface CustomerPhone { id: number; phone: string; sortOrder: number }
interface Customer {
  id: number;
  name: string;
  isActive: boolean;
  reminderOptOut?: boolean;
  phones: CustomerPhone[];
}

export default function CustomersPage() {
  const { apiFetch } = useApi();
  const { activeGroupId, activeGroupRole } = useGroup();
  const isAdmin = (activeGroupRole === 'owner' || activeGroupRole === 'manager');
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showSend, setShowSend] = useState(false);

  function toggleSelect(id: number, optOut?: boolean) {
    if (optOut) return; // opted-out customers can't be selected
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;

  function load() {
    if (!activeGroupId) return;
    setLoading(true);
    setError(false);
    apiFetch<{ customers: Customer[] }>('/customers')
      .then((d) => setCustomers([...d.customers].sort((a, b) => a.name.localeCompare(b.name, 'he'))))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId]);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const { customer } = await apiFetch<{ customer: Customer }>('/customers', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() }),
      });
      setCustomers((prev) => [...prev, { ...customer, phones: customer.phones ?? [] }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setShowAdd(false);
      toast.success(t('customers.saved'));
    } catch {
      toast.error(t('customers.save_failed'));
    } finally {
      setAdding(false);
    }
  }

  const phoneQuery = search.replace(/\D/g, '');
  const idW = docketWidth(customers.map((c) => c.id));
  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (phoneQuery !== '' &&
        c.phones.some((p) => p.phone.replace(/\D/g, '').includes(phoneQuery)))
  );
  const hasSearch = search.trim() !== '';
  const selectedPhoneCount = [...selected].reduce(
    (sum, id) => sum + (customers.find((c) => c.id === id)?.phones.length ?? 0),
    0
  );

  return (
    <div className="p-5 space-y-4 animate-fade-in">
      <div className="flex justify-between items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">{t('customers.title')}</h1>
        <div className="flex items-center gap-2">
          {isAdmin && !showAdd && (
            selectMode ? (
              <Button size="sm" variant="ghost" onClick={exitSelect}>
                {t('reminders.cancel')}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setSelectMode(true)}>
                <CheckSquare className="h-4 w-4" />
                {t('reminders.select')}
              </Button>
            )
          )}
          {!showAdd && !selectMode && (
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
      ) : error ? (
        <Card className="flex flex-col items-center text-center gap-3 py-8 bg-destructive/10">
          <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-sm text-destructive">טעינת הלקוחות נכשלה</p>
          <Button variant="outline" onClick={load} className="min-h-11">
            נסו שוב
          </Button>
        </Card>
      ) : filtered.length === 0 ? (
        hasSearch && customers.length > 0 ? (
          <EmptyState icon={SearchX} title="לא נמצאו תוצאות" />
        ) : (
          <EmptyState
            icon={Users}
            title={t('customers.empty')}
            description={t('customers.empty_hint')}
          />
        )
      ) : (
        <Card className="p-0 overflow-hidden">
          {filtered.map((c, idx) => {
            const firstPhone = c.phones[0]?.phone;
            const extraCount = c.phones.length - 1;
            const rowInner = (
              <div
                className={cn(
                  'flex items-stretch transition-colors',
                  selectMode && selected.has(c.id) ? 'bg-primary/5' : 'hover:bg-muted/40',
                  idx > 0 && 'border-t border-dashed border-border',
                  selectMode && c.reminderOptOut && 'opacity-40'
                )}
              >
                <DocketStub id={c.id} width={idW} />
                <div className="flex flex-1 items-center gap-3 px-3 py-3 min-w-0">
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      readOnly
                      disabled={c.reminderOptOut}
                      className="h-4 w-4 accent-primary shrink-0"
                    />
                  )}
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {getInitial(c.name)}
                  </div>
                  <div className="min-w-0">
                    <span className="block font-medium truncate">{c.name}</span>
                    {firstPhone && (
                      <span className="block text-sm text-muted-foreground truncate">
                        {firstPhone}
                        {extraCount > 0 && (
                          <span className="text-muted-foreground/60"> +{extraCount}</span>
                        )}
                      </span>
                    )}
                  </div>
                  {selectMode ? (
                    c.reminderOptOut && (
                      <span className="ms-auto text-[10px] font-medium text-destructive/70 shrink-0">
                        {t('reminders.opt_out_on')}
                      </span>
                    )
                  ) : (
                    <Chevron className="ms-auto h-4 w-4 text-muted-foreground/30 shrink-0" />
                  )}
                </div>
              </div>
            );
            return selectMode ? (
              <div key={c.id} onClick={() => toggleSelect(c.id, c.reminderOptOut)} className="cursor-pointer">
                {rowInner}
              </div>
            ) : (
              <Link key={c.id} href={`/miniapp/customers/${c.id}`}>
                {rowInner}
              </Link>
            );
          })}
        </Card>
      )}

      {selectMode && (
        <div className="sticky bottom-14 -mx-5 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-3 backdrop-blur-md">
          <span className="text-sm text-muted-foreground">
            {t('reminders.selected_count').replace('{n}', String(selected.size))}
          </span>
          <Button size="sm" disabled={selected.size === 0} onClick={() => setShowSend(true)}>
            <Send className="h-4 w-4" />
            {t('reminders.send')}
          </Button>
        </div>
      )}

      {showSend && (
        <SendReminderSheet
          customerIds={[...selected]}
          count={selectedPhoneCount}
          onClose={() => setShowSend(false)}
          onSent={exitSelect}
        />
      )}
    </div>
  );
}
