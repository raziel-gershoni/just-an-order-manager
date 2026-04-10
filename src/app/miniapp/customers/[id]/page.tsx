'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useT, useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateRelative } from '@/lib/date-utils';
import { t as translate } from '@/lib/i18n';
import Link from 'next/link';

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
}
interface Order { id: number; deliveryDate: string | null; status: string; totalQuantity: number; itemsSummary: string }
interface Payment { id: number; amount: string; type: string; description: string | null; createdAt: string }

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiFetch } = useApi();
  const t = useT();
  const lang = useLang();
  const toast = useToast();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

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

  function startEditing() {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(customer.phone || '');
    setEditAddress(customer.address || '');
    setEditCity(customer.city || '');
    setEditNotes(customer.notes || '');
    setEditing(true);
  }

  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const { customer: updated } = await apiFetch<{ customer: Customer }>(
        `/customers/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: editName.trim(),
            phone: editPhone || undefined,
            address: editAddress || undefined,
            city: editCity || undefined,
            notes: editNotes || undefined,
          }),
        }
      );
      setCustomer(updated);
      setEditing(false);
      toast.success(t('customers.saved'));
    } catch {
      toast.error(t('customers.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('form.customer')} />
        <div className="p-4 text-center opacity-50">{t('general.loading')}</div>
      </>
    );
  }

  if (!customer) {
    return (
      <>
        <PageHeader title={t('form.customer')} />
        <div className="p-4 text-center">{t('customers.not_found')}</div>
      </>
    );
  }

  const balanceNum = Number(balance);

  return (
    <>
      <PageHeader title={customer.name} />
      <div className="p-4 space-y-4 animate-fade-in">
        {/* Balance */}
        <Card
          className={
            balanceNum < 0
              ? 'border border-red-200'
              : balanceNum > 0
              ? 'border border-green-200'
              : 'border border-green-200'
          }
        >
          <div className="text-center">
            <span className="text-sm opacity-60">{t('customers.balance')}</span>
            {balanceNum === 0 ? (
              <div className="text-2xl font-bold text-green-600">
                {t('customers.balance_square')}
              </div>
            ) : (
              <>
                <div className={`text-3xl font-bold ${
                  balanceNum < 0 ? 'text-red-600' : 'text-green-600'
                }`}>
                  ₪{Math.abs(balanceNum).toFixed(0)}
                </div>
                <span className={`text-sm ${
                  balanceNum < 0 ? 'text-red-500' : 'text-green-500'
                }`}>
                  {balanceNum > 0 ? t('customers.balance_credit') : t('customers.balance_debt')}
                </span>
              </>
            )}
          </div>
        </Card>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link href={`/miniapp/orders/new?customerId=${customer.id}`}>
            <Button className="w-full" size="sm">{t('dash.new_order')}</Button>
          </Link>
          <Link href={`/miniapp/payments?customerId=${customer.id}`}>
            <Button variant="secondary" className="w-full" size="sm">
              {t('dash.record_payment')}
            </Button>
          </Link>
        </div>

        {/* Info / Edit */}
        <Card>
          {editing ? (
            <div className="space-y-3">
              <Input
                label={t('form.customer_name')}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <Input
                label={t('customers.phone')}
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                type="tel"
              />
              <Input
                label={t('customers.address')}
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
              />
              <Input
                label={t('customers.city')}
                value={editCity}
                onChange={(e) => setEditCity(e.target.value)}
              />
              <TextArea
                label={t('notify.notes')}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!editName.trim() || saving}
                  onClick={handleSave}
                >
                  {saving ? '...' : t('settings.save')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  {t('payments.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between items-start">
                <div className="space-y-2 flex-1">
                  {customer.phone && (
                    <div className="flex justify-between">
                      <span className="opacity-60">{t('customers.phone')}</span>
                      <span>{customer.phone}</span>
                    </div>
                  )}
                  {customer.address && (
                    <div className="flex justify-between">
                      <span className="opacity-60">{t('customers.address')}</span>
                      <span>{customer.address}</span>
                    </div>
                  )}
                  {customer.city && (
                    <div className="flex justify-between">
                      <span className="opacity-60">{t('customers.city')}</span>
                      <span>{customer.city}</span>
                    </div>
                  )}
                  {customer.notes && (
                    <div>
                      <span className="opacity-60">{t('notify.notes')}</span>
                      <p className="mt-1">{customer.notes}</p>
                    </div>
                  )}
                  {!customer.phone && !customer.address && !customer.city && !customer.notes && (
                    <p className="text-sm opacity-40">{t('customers.empty_hint')}</p>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={startEditing}>
                  {t('customers.edit')}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Order History */}
        <div>
          <h2 className="font-bold mb-2">{t('customers.order_history')} ({orders.length})</h2>
          {orders.length === 0 ? (
            <p className="text-sm opacity-40">{t('orders.empty')}</p>
          ) : (
            <div className="space-y-2">
              {orders.slice(0, 10).map((o) => (
                <Link key={o.id} href={`/miniapp/orders/${o.id}`}>
                  <Card className={`flex items-center justify-between py-2 border-status-${o.status}`}>
                    <span className="text-sm">
                      {o.itemsSummary}
                      {o.deliveryDate && (
                        <span className="opacity-50 ms-2">{formatDateRelative(o.deliveryDate, lang)}</span>
                      )}
                    </span>
                    <Badge status={o.status} label={translate(`status.${o.status}`, lang)} />
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Payment History */}
        <div>
          <h2 className="font-bold mb-2">{t('customers.payment_history')} ({payments.length})</h2>
          {payments.length === 0 ? (
            <p className="text-sm opacity-40">{t('orders.empty')}</p>
          ) : (
            <div className="space-y-1">
              {payments.slice(0, 10).map((p) => (
                <div key={p.id} className="flex justify-between text-sm py-1">
                  <div>
                    <span>{translate(`payment.${p.type}`, lang)}</span>
                    {p.description && (
                      <span className="opacity-50 ms-2">{p.description}</span>
                    )}
                  </div>
                  <span className={Number(p.amount) >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {Number(p.amount) >= 0 ? '+' : ''}₪{Math.abs(Number(p.amount)).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
