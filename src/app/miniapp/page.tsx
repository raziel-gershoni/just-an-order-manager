'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

interface DashboardData {
  todayOrders: {
    id: number;
    quantity: number;
    status: string;
    notes: string | null;
    customerName: string;
    breadTypeName: string;
  }[];
  upcomingOrders: {
    id: number;
    quantity: number;
    deliveryDate: string | null;
    status: string;
    customerName: string;
    breadTypeName: string;
  }[];
  pendingCount: number;
  customersWithDebt: {
    customerId: number;
    customerName: string;
    balance: string;
  }[];
  totalPendingLoaves: number;
}

export default function Dashboard() {
  const { apiFetch } = useApi();
  const { activeGroupId, setActiveGroupId } = useGroup();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Onboarding state
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!activeGroupId) return;
    setLoading(true);
    apiFetch<DashboardData>('/dashboard')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId]);

  async function handleCreateGroup() {
    if (!groupName.trim()) return;
    setCreating(true);
    try {
      const { group } = await apiFetch<{ group: { id: number } }>('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName.trim() }),
      });
      setActiveGroupId(group.id);
    } catch {
      alert('Failed to create group');
    } finally {
      setCreating(false);
    }
  }

  if (!activeGroupId) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold text-center">Welcome!</h1>
        <Card>
          <h3 className="font-medium mb-3">Create your bakery group</h3>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-black/10 bg-[var(--tg-theme-bg-color,#ffffff)] px-3 py-2 text-base outline-none"
              placeholder="Group name..."
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <Button disabled={!groupName.trim() || creating} onClick={handleCreateGroup}>
              {creating ? '...' : 'Create'}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 text-center opacity-50">Loading...</div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/miniapp/orders/new">
          <Button className="w-full" size="lg">
            + New Order
          </Button>
        </Link>
        <Link href="/miniapp/payments">
          <Button variant="secondary" className="w-full" size="lg">
            Record Payment
          </Button>
        </Link>
      </div>

      {/* Today's Orders */}
      <Card>
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold text-lg">Today</h2>
          <span className="text-sm opacity-60">
            {data?.totalPendingLoaves ?? 0} loaves
          </span>
        </div>
        {data?.todayOrders.length === 0 ? (
          <p className="text-sm opacity-50">No orders for today</p>
        ) : (
          <div className="space-y-2">
            {data?.todayOrders.map((o) => (
              <Link
                key={o.id}
                href={`/miniapp/orders/${o.id}`}
                className="flex items-center justify-between py-1"
              >
                <div>
                  <span className="font-medium">{o.customerName}</span>
                  <span className="text-sm opacity-60 ml-2">
                    {o.quantity} {o.breadTypeName}
                  </span>
                </div>
                <Badge status={o.status} label={o.status} />
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Upcoming */}
      {data?.upcomingOrders && data.upcomingOrders.length > 0 && (
        <Card>
          <h2 className="font-bold text-lg mb-3">Upcoming</h2>
          <div className="space-y-2">
            {data.upcomingOrders.map((o) => (
              <Link
                key={o.id}
                href={`/miniapp/orders/${o.id}`}
                className="flex items-center justify-between py-1"
              >
                <div>
                  <span className="font-medium">{o.customerName}</span>
                  <span className="text-sm opacity-60 ml-2">
                    {o.quantity} {o.breadTypeName}
                  </span>
                </div>
                <span className="text-xs opacity-50">{o.deliveryDate}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Debt alerts */}
      {data?.customersWithDebt && data.customersWithDebt.length > 0 && (
        <Card className="border border-red-200">
          <h2 className="font-bold text-lg mb-3 text-red-600">
            Outstanding Balances
          </h2>
          <div className="space-y-1">
            {data.customersWithDebt.map((c) => (
              <Link
                key={c.customerId}
                href={`/miniapp/customers/${c.customerId}`}
                className="flex justify-between py-1"
              >
                <span>{c.customerName}</span>
                <span className="text-red-600 font-medium">
                  {Number(c.balance).toFixed(0)}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Navigation */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Link href="/miniapp/orders">
          <Button variant="ghost" className="w-full">
            All Orders
          </Button>
        </Link>
        <Link href="/miniapp/customers">
          <Button variant="ghost" className="w-full">
            Customers
          </Button>
        </Link>
      </div>

      <div className="text-center pt-2">
        <Link href="/miniapp/settings">
          <Button variant="ghost" size="sm">
            Settings
          </Button>
        </Link>
      </div>
    </div>
  );
}
