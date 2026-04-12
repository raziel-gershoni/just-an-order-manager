'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

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
    <div className="p-4 space-y-4 animate-fade-in">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold">{t('customers.title')}</h1>
        {!showAdd && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            + {t('form.add_customer')}
          </Button>
        )}
      </div>

      {showAdd && (
        <Card>
          <div className="flex gap-2">
            <Input
              placeholder={t('form.customer_name')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
            />
            <Button size="sm" disabled={!newName.trim() || adding} onClick={handleAdd}>
              {adding ? '...' : t('form.add')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); setNewName(''); }}>
              {t('payments.cancel')}
            </Button>
          </div>
        </Card>
      )}

      <Input
        placeholder={t('customers.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <div className="text-center opacity-50 py-8">{t('general.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">👥</p>
          <p className="font-medium opacity-70">{t('customers.empty')}</p>
          <p className="text-sm opacity-40 mt-1">{t('customers.empty_hint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Link key={c.id} href={`/miniapp/customers/${c.id}`}>
              <Card className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{c.name}</span>
                  {c.phone && (
                    <span className="text-sm opacity-50 ms-2">{c.phone}</span>
                  )}
                </div>
                <span className="text-sm opacity-30">→</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
