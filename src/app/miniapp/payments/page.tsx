'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';

interface Customer {
  id: number;
  name: string;
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center opacity-50">Loading...</div>}>
      <PaymentsContent />
    </Suspense>
  );
}

function PaymentsContent() {
  const { apiFetch } = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();

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
      router.back();
    } catch {
      alert('Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="p-4 text-center opacity-50">Loading...</div>;
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Record Payment</h1>

      {/* Type toggle */}
      <div className="flex gap-2">
        <button
          className={`flex-1 py-3 rounded-lg font-medium transition ${
            type === 'payment'
              ? 'bg-green-500 text-white'
              : 'bg-black/5'
          }`}
          onClick={() => setType('payment')}
        >
          Payment (+)
        </button>
        <button
          className={`flex-1 py-3 rounded-lg font-medium transition ${
            type === 'charge'
              ? 'bg-red-500 text-white'
              : 'bg-black/5'
          }`}
          onClick={() => setType('charge')}
        >
          Charge (-)
        </button>
      </div>

      {/* Customer */}
      <Card>
        <h3 className="font-medium mb-2">Customer</h3>
        {customerId && selectedCustomer ? (
          <div className="flex items-center justify-between">
            <span className="font-bold">{selectedCustomer.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCustomerId(null)}
            >
              Change
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

      {/* Amount */}
      <Input
        label="Amount"
        type="number"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
      />

      {/* Description */}
      <Input
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g., Cash payment"
      />

      <Button
        className="w-full"
        size="lg"
        variant={type === 'charge' ? 'danger' : 'primary'}
        disabled={!customerId || !amount || submitting}
        onClick={handleSubmit}
      >
        {submitting
          ? 'Recording...'
          : type === 'payment'
          ? `Record Payment +${amount || '0'}`
          : `Record Charge -${amount || '0'}`}
      </Button>

      <div className="text-center pt-2">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
