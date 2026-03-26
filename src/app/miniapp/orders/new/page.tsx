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
  const [breadTypeId, setBreadTypeId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
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
        if (b.breadTypes.length > 0) setBreadTypeId(b.breadTypes[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase())
  );

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
    if (!customerId || !breadTypeId) return;
    setSubmitting(true);
    try {
      await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          breadTypeId,
          quantity,
          deliveryType,
          deliveryDate: deliveryType === 'specific_date' ? deliveryDate : undefined,
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

        {/* Bread Type */}
        <Card>
          <h3 className="font-medium mb-2">{t('form.bread_type')}</h3>
          <div className="flex flex-wrap gap-2">
            {breadTypes.map((bt) => (
              <button
                key={bt.id}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  breadTypeId === bt.id
                    ? 'bg-[var(--tg-theme-button-color,#3b82f6)] text-[var(--tg-theme-button-text-color,#ffffff)]'
                    : 'bg-black/5 hover:bg-black/10'
                }`}
                onClick={() => setBreadTypeId(bt.id)}
              >
                {bt.name}
              </button>
            ))}
          </div>
        </Card>

        {/* Quantity */}
        <Card>
          <h3 className="font-medium mb-2">{t('form.quantity')}</h3>
          <div className="flex items-center gap-4">
            <button
              className="w-10 h-10 rounded-full bg-black/5 text-xl font-bold"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >−</button>
            <span className="text-2xl font-bold w-8 text-center">{quantity}</span>
            <button
              className="w-10 h-10 rounded-full bg-black/5 text-xl font-bold"
              onClick={() => setQuantity((q) => q + 1)}
            >+</button>
          </div>
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
          disabled={!customerId || !breadTypeId || submitting}
          onClick={handleSubmit}
        >
          {submitting ? t('form.creating') : t('form.create_order')}
        </Button>
      </div>
    </>
  );
}
