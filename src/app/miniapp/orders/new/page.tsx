'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

interface Customer { id: number; name: string }
interface BreadType { id: number; name: string; price: string }
interface LineItem { breadTypeId: number; quantity: number }

type DeliveryType = 'shabbat' | 'asap' | 'specific_date' | 'weekly';

export default function NewOrderPage() {
  const { apiFetch } = useApi();
  const router = useRouter();
  const t = useT();
  const toast = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [breadTypes, setBreadTypes] = useState<BreadType[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('shabbat');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch<{ customers: Customer[] }>('/customers'),
      apiFetch<{ breadTypes: BreadType[] }>('/bread-types'),
    ])
      .then(([c, b]) => {
        setCustomers(c.customers);
        setBreadTypes(b.breadTypes);
        if (b.breadTypes.length > 0) {
          setItems([{ breadTypeId: b.breadTypes[0].id, quantity: 1 }]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase())
  );

  function updateItem(index: number, update: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...update } : item))
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    if (breadTypes.length === 0) return;
    setItems((prev) => [...prev, { breadTypeId: breadTypes[0].id, quantity: 1 }]);
  }

  async function handleCreateCustomer() {
    if (!newCustomerName.trim()) return;
    const { customer } = await apiFetch<{ customer: Customer }>('/customers', {
      method: 'POST',
      body: JSON.stringify({ name: newCustomerName.trim() }),
    });
    setCustomers((prev) => [...prev, customer]);
    setCustomerId(customer.id);
    setShowNewCustomer(false);
    setNewCustomerName('');
  }

  async function handleSubmit() {
    if (!customerId || items.length === 0) return;
    setSubmitting(true);
    try {
      await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          deliveryType,
          deliveryDate: deliveryType === 'specific_date' ? deliveryDate : undefined,
          items,
          notes: notes || undefined,
        }),
      });
      toast.success(t('orders.created'));
      router.push('/miniapp');
    } catch {
      toast.error(t('orders.create_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('orders.new_order')} />
        <div className="p-4 text-center opacity-50">{t('general.loading')}</div>
      </>
    );
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const deliveryOptions: [DeliveryType, string][] = [
    ['shabbat', t('delivery.shabbat')],
    ['asap', t('delivery.asap')],
    ['specific_date', t('delivery.specific_date')],
    ['weekly', t('delivery.weekly')],
  ];

  return (
    <>
      <PageHeader title={t('orders.new_order')} />
      <div className="p-4 space-y-4 animate-fade-in">
        {/* Customer */}
        <Card>
          <h3 className="font-medium mb-2">{t('form.customer')}</h3>
          {customerId ? (
            <div className="flex items-center justify-between">
              <span className="font-bold">{selectedCustomer?.name}</span>
              <Button variant="ghost" size="sm" onClick={() => setCustomerId(null)}>
                {t('form.change')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                placeholder={t('form.search_customer')}
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
              <div className="max-h-40 overflow-y-auto space-y-1">
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-black/5 transition"
                    onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              {!showNewCustomer ? (
                <Button variant="ghost" size="sm" onClick={() => setShowNewCustomer(true)}>
                  + {t('form.add_customer')}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder={t('form.customer_name')}
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleCreateCustomer}>{t('form.add')}</Button>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Line Items */}
        <Card>
          <h3 className="font-medium mb-3">{t('form.bread_type')}</h3>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                {/* Bread type selector */}
                <select
                  className="flex-1 rounded-lg border border-black/10 bg-[var(--tg-theme-bg-color,#ffffff)] px-3 py-2 text-sm"
                  value={item.breadTypeId}
                  onChange={(e) =>
                    updateItem(idx, { breadTypeId: Number(e.target.value) })
                  }
                >
                  {breadTypes.map((bt) => (
                    <option key={bt.id} value={bt.id}>
                      {bt.name} (₪{bt.price})
                    </option>
                  ))}
                </select>
                {/* Quantity */}
                <div className="flex items-center gap-1">
                  <button
                    className="w-8 h-8 rounded-full bg-black/5 text-sm font-bold"
                    onClick={() =>
                      updateItem(idx, { quantity: Math.max(1, item.quantity - 1) })
                    }
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-bold">{item.quantity}</span>
                  <button
                    className="w-8 h-8 rounded-full bg-black/5 text-sm font-bold"
                    onClick={() =>
                      updateItem(idx, { quantity: item.quantity + 1 })
                    }
                  >
                    +
                  </button>
                </div>
                {/* Remove */}
                {items.length > 1 && (
                  <button
                    className="w-8 h-8 rounded-full text-red-500 hover:bg-red-50 text-sm"
                    onClick={() => removeItem(idx)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={addItem}
          >
            + {t('form.add')}
          </Button>
        </Card>

        {/* Delivery */}
        <Card>
          <h3 className="font-medium mb-2">{t('form.delivery')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {deliveryOptions.map(([type, label]) => (
              <button
                key={type}
                className={`px-4 py-3 rounded-lg text-sm font-medium transition ${
                  deliveryType === type
                    ? 'bg-[var(--tg-theme-button-color,#3b82f6)] text-[var(--tg-theme-button-text-color,#ffffff)]'
                    : 'bg-black/5 hover:bg-black/10'
                }`}
                onClick={() => setDeliveryType(type)}
              >
                {label}
              </button>
            ))}
          </div>
          {deliveryType === 'specific_date' && (
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="mt-2"
            />
          )}
        </Card>

        {/* Notes */}
        <TextArea
          label={t('form.notes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('form.notes_placeholder')}
        />

        {/* Submit */}
        <Button
          className="w-full"
          size="lg"
          disabled={!customerId || items.length === 0 || submitting}
          onClick={handleSubmit}
        >
          {submitting ? t('form.creating') : t('form.create_order')}
        </Button>
      </div>
    </>
  );
}
