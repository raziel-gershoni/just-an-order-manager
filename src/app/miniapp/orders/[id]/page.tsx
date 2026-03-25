'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

interface OrderDetail {
  id: number;
  quantity: number;
  deliveryType: string;
  deliveryDate: string | null;
  status: string;
  pricePerUnit: string | null;
  notes: string | null;
  createdAt: string;
  customerName: string;
  customerId: number;
  breadTypeName: string;
}

const statusActions: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['baking', 'cancelled'],
  baking: ['ready'],
  ready: ['delivered'],
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ order: OrderDetail }>(`/orders/${id}`)
      .then((d) => setOrder(d.order))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function updateStatus(status: string) {
    await apiFetch(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setOrder((prev) => (prev ? { ...prev, status } : prev));
  }

  if (loading) {
    return <div className="p-4 text-center opacity-50">Loading...</div>;
  }

  if (!order) {
    return <div className="p-4 text-center">Order not found</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Order #{order.id}</h1>
        <Badge status={order.status} label={order.status} />
      </div>

      <Card>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="opacity-60">Customer</span>
            <Link
              href={`/miniapp/customers/${order.customerId}`}
              className="font-medium underline"
            >
              {order.customerName}
            </Link>
          </div>
          <div className="flex justify-between">
            <span className="opacity-60">Bread Type</span>
            <span className="font-medium">{order.breadTypeName}</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-60">Quantity</span>
            <span className="font-medium">{order.quantity}</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-60">Delivery</span>
            <span className="font-medium">
              {order.deliveryDate ?? order.deliveryType}
            </span>
          </div>
          {order.pricePerUnit && (
            <div className="flex justify-between">
              <span className="opacity-60">Price/unit</span>
              <span className="font-medium">{order.pricePerUnit}</span>
            </div>
          )}
          {order.notes && (
            <div>
              <span className="opacity-60">Notes</span>
              <p className="mt-1">{order.notes}</p>
            </div>
          )}
          <div className="flex justify-between text-sm opacity-50">
            <span>Created</span>
            <span>{new Date(order.createdAt).toLocaleString()}</span>
          </div>
        </div>
      </Card>

      {/* Status actions */}
      {statusActions[order.status] && (
        <div className="flex gap-2 flex-wrap">
          {statusActions[order.status].map((s) => (
            <Button
              key={s}
              variant={s === 'cancelled' ? 'danger' : 'primary'}
              className="flex-1"
              onClick={() => updateStatus(s)}
            >
              Mark as {s}
            </Button>
          ))}
        </div>
      )}

      {/* Record charge prompt on delivery */}
      {order.status === 'delivered' && order.pricePerUnit && (
        <Card className="border border-yellow-200">
          <p className="text-sm mb-2">
            Record charge of{' '}
            {(Number(order.pricePerUnit) * order.quantity).toFixed(2)} for
            this order?
          </p>
          <Link
            href={`/miniapp/payments?customerId=${order.customerId}&orderId=${order.id}&amount=${(Number(order.pricePerUnit) * order.quantity).toFixed(2)}`}
          >
            <Button size="sm" variant="secondary">
              Record Charge
            </Button>
          </Link>
        </Card>
      )}

      <div className="text-center pt-2">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          Back
        </Button>
      </div>
    </div>
  );
}
