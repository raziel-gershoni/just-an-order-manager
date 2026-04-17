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
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { getInitial } from '@/lib/name-utils';

interface Customer { id: number; name: string }

export default function PaymentsPage() {
  return (
    <Suspense fallback={
      <div className="p-5 space-y-4">
        <div className="h-14 rounded-xl bg-muted animate-pulse" />
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      </div>
    }>
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
        <div className="p-5 space-y-4">
          <div className="h-14 rounded-xl bg-muted animate-pulse" />
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        </div>
      </>
    );
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);

  return (
    <>
      <PageHeader title={t('payments.title')} />
      <div className="p-5 space-y-4 animate-fade-in">
        {/* Type toggle */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          <button
            className={cn(
              'flex-1 py-2.5 rounded-md text-sm font-medium transition-all',
              type === 'payment'
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setType('payment')}
          >
            {t('payments.payment_plus')}
          </button>
          <button
            className={cn(
              'flex-1 py-2.5 rounded-md text-sm font-medium transition-all',
              type === 'charge'
                ? 'bg-destructive text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setType('charge')}
          >
            {t('payments.charge_minus')}
          </button>
        </div>

        {/* Customer */}
        <Card>
          <h3 className="font-semibold mb-3">{t('form.customer')}</h3>
          {customerId && selectedCustomer ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                  {getInitial(selectedCustomer.name)}
                </div>
                <span className="font-medium">{selectedCustomer.name}</span>
                <Check className="h-4 w-4 text-emerald-500" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCustomerId(null)}>
                {t('form.change')}
              </Button>
            </div>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {customers.map((c) => (
                <button
                  key={c.id}
                  className="w-full text-start px-3 py-2.5 rounded-lg hover:bg-muted transition-colors flex items-center gap-2"
                  onClick={() => setCustomerId(c.id)}
                >
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                    {getInitial(c.name)}
                  </div>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="space-y-3">
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
        </Card>

        <Button
          className="w-full"
          size="lg"
          variant={type === 'charge' ? 'danger' : 'primary'}
          disabled={!customerId || !amount}
          loading={submitting}
          onClick={handleSubmit}
        >
          {`${t('payments.record')} ${type === 'payment' ? '+' : '-'}₪${amount || '0'}`}
        </Button>
      </div>
    </>
  );
}
