'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
}

interface Order {
  id: number;
  quantity: number;
  deliveryDate: string | null;
  status: string;
  breadTypeName: string;
}

interface Payment {
  id: number;
  amount: string;
  type: string;
  description: string | null;
  createdAt: string;
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiFetch } = useApi();
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<{ customer: Customer }>(`/customers/${id}`),
      apiFetch<{ balance: string }>(`/customers/${id}/balance`),
      apiFetch<{ orders: Order[] }>(`/orders?customerId=${id}`),
      apiFetch<{ payments: Payment[] }>(`/payments?customerId=${id}`),
    ])
      .then(([c, b, o, p]) => {
        setCustomer(c.customer);
        setBalance(b.balance);
        setOrders(o.orders);
        setPayments(p.payments);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="p-4 text-center opacity-50">Loading...</div>;
  }

  if (!customer) {
    return <div className="p-4 text-center">Customer not found</div>;
  }

  const balanceNum = Number(balance);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">{customer.name}</h1>

      {/* Balance */}
      <Card
        className={
          balanceNum < 0
            ? 'border border-red-200'
            : balanceNum > 0
            ? 'border border-green-200'
            : ''
        }
      >
        <div className="text-center">
          <span className="text-sm opacity-60">Balance</span>
          <div
            className={`text-3xl font-bold ${
              balanceNum < 0
                ? 'text-red-600'
                : balanceNum > 0
                ? 'text-green-600'
                : ''
            }`}
          >
            {balanceNum.toFixed(0)}
          </div>
        </div>
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href={`/miniapp/orders/new?customerId=${customer.id}`}>
          <Button className="w-full" size="sm">
            New Order
          </Button>
        </Link>
        <Link href={`/miniapp/payments?customerId=${customer.id}`}>
          <Button variant="secondary" className="w-full" size="sm">
            Record Payment
          </Button>
        </Link>
      </div>

      {/* Info */}
      <Card>
        {customer.phone && (
          <div className="flex justify-between py-1">
            <span className="opacity-60">Phone</span>
            <span>{customer.phone}</span>
          </div>
        )}
        {customer.notes && (
          <div className="pt-1">
            <span className="opacity-60">Notes</span>
            <p className="mt-1">{customer.notes}</p>
          </div>
        )}
      </Card>

      {/* Order History */}
      <div>
        <h2 className="font-bold mb-2">Orders ({orders.length})</h2>
        <div className="space-y-2">
          {orders.slice(0, 10).map((o) => (
            <Link key={o.id} href={`/miniapp/orders/${o.id}`}>
              <Card className="flex items-center justify-between py-2">
                <span className="text-sm">
                  {o.quantity} {o.breadTypeName}
                  {o.deliveryDate && (
                    <span className="opacity-50 ml-2">{o.deliveryDate}</span>
                  )}
                </span>
                <Badge status={o.status} label={o.status} />
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Payment History */}
      <div>
        <h2 className="font-bold mb-2">Payments ({payments.length})</h2>
        <div className="space-y-1">
          {payments.slice(0, 10).map((p) => (
            <div key={p.id} className="flex justify-between text-sm py-1">
              <div>
                <span className="capitalize">{p.type}</span>
                {p.description && (
                  <span className="opacity-50 ml-2">{p.description}</span>
                )}
              </div>
              <span
                className={
                  Number(p.amount) >= 0 ? 'text-green-600' : 'text-red-600'
                }
              >
                {Number(p.amount) >= 0 ? '+' : ''}
                {Number(p.amount).toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center pt-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          Back
        </Button>
      </div>
    </div>
  );
}
