'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

interface Customer { id: number; name: string }

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center opacity-50">...</div>}>
      <PaymentsContent />
    </Suspense>
  );
}

function PaymentsContent() {
  const { apiFetch } = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT();
  const toast = useToast();

  const presetCustomerId = searchParams.get('customerId');
  const presetOrderId = searchParams.get('orderId');
  const presetAmount = searchParams.get('amount');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [customerId, setCustomerId] = useState<number | null>(
    presetCustomerId ? Number(presetCustomerId) : null
  );
  const [amount, setAmount] = useState(presetAmount || '');
  const [type, setType] = useState<'payment' | 'charge'>(
    presetOrderId ? 'charge' : 'payment'
  );
  const [description, setDescription] = useState('');

  useEffect(() => {
    apiFetch<{ customers: Customer[] }>('/customers')
      .then((d) => setCustomers(d.customers))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit() {
    if (!customerId || !amount) return;
    setSubmitting(true);
    try {
      await apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          amount,
          type,
          orderId: presetOrderId ? Number(presetOrderId) : undefined,
          description: description || undefined,
        }),
      });
      toast.success(t('payments.success'));
      router.back();
    } catch {
      toast.error(t('payments.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('payments.title')} />
        <div className="p-4 text-center opacity-50">{t('general.loading')}</div>
      </>
    );
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);

  return (
    <>
      <PageHeader title={t('payments.title')} />
      <div className="p-4 space-y-4 animate-fade-in">
        {/* Type toggle */}
        <div className="flex gap-2">
          <button
            className={`flex-1 py-3 rounded-lg font-medium transition ${
              type === 'payment' ? 'bg-green-500 text-white' : 'bg-black/5'
            }`}
            onClick={() => setType('payment')}
          >
            {t('payments.payment_plus')}
          </button>
          <button
            className={`flex-1 py-3 rounded-lg font-medium transition ${
              type === 'charge' ? 'bg-red-500 text-white' : 'bg-black/5'
            }`}
            onClick={() => setType('charge')}
          >
            {t('payments.charge_minus')}
          </button>
        </div>

        {/* Customer */}
        <Card>
          <h3 className="font-medium mb-2">{t('form.customer')}</h3>
          {customerId && selectedCustomer ? (
            <div className="flex items-center justify-between">
              <span className="font-bold">{selectedCustomer.name}</span>
              <Button variant="ghost" size="sm" onClick={() => setCustomerId(null)}>
                {t('form.change')}
              </Button>
            </div>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {customers.map((c) => (
                <button
                  key={c.id}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-black/5"
                  onClick={() => setCustomerId(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </Card>

        <Input
          label={t('payments.amount')}
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />

        <Input
          label={t('payments.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('payments.description_hint')}
        />

        <Button
          className="w-full"
          size="lg"
          variant={type === 'charge' ? 'danger' : 'primary'}
          disabled={!customerId || !amount || submitting}
          onClick={handleSubmit}
        >
          {submitting
            ? t('payments.recording')
            : `${t('payments.record')} ${type === 'payment' ? '+' : '-'}₪${amount || '0'}`}
        </Button>
      </div>
    </>
  );
}
