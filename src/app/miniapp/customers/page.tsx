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
import { cn } from '@/lib/utils';
import { getInitial } from '@/lib/name-utils';
import { buildWhatsAppLink } from '@/lib/whatsapp';
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
  const [showReminders, setShowReminders] = useState(false);

  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;

  function reminderText(name: string) {
    return t('reminder.message').replace('{name}', name);
  }

  function openWhatsApp(phone: string, name: string, e?: React.MouseEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const link = buildWhatsAppLink(phone, reminderText(name));
    if (!link) {
      toast.error(t('reminder.invalid_phone'));
      return;
    }
    window.open(link, '_blank', 'noopener,noreferrer');
  }

  const customersWithPhone = customers.filter((c) => c.phone);

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
              onClick={() => setShowReminders(true)}
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
                      onClick={(e) => openWhatsApp(c.phone!, c.name, e)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50 transition-colors"
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

      {showReminders && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowReminders(false)}
        >
          <div
            className="w-full max-w-md bg-card rounded-2xl shadow-xl max-h-[80vh] flex flex-col animate-slide-down"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h2 className="font-bold">{t('reminder.dialog_title')}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{t('reminder.dialog_hint')}</p>
              </div>
              <button
                onClick={() => setShowReminders(false)}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2 flex flex-col gap-1">
              {customersWithPhone.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {t('reminder.no_phone_customers')}
                </p>
              ) : (
                customersWithPhone.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openWhatsApp(c.phone!, c.name)}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-start"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {getInitial(c.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{c.phone}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-emerald-600 shrink-0">
                      <MessageCircle className="h-4 w-4" />
                      <span className="text-xs font-medium">{t('reminder.whatsapp')}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
