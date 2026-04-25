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
import { cn } from '@/lib/utils';
import { Plus, Banknote, Pencil, MessageCircle, Repeat } from 'lucide-react';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import Link from 'next/link';

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
}
interface Order { id: number; deliveryDate: string | null; status: string; paid: boolean; isRecurring?: boolean; totalQuantity: number; itemsSummary: string }
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
        <div className="p-5 space-y-4">
          <div className="h-28 rounded-xl bg-muted animate-pulse" />
          <div className="h-14 rounded-xl bg-muted animate-pulse" />
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        </div>
      </>
    );
  }

  if (!customer) {
    return (
      <>
        <PageHeader title={t('form.customer')} />
        <div className="p-5 text-center text-muted-foreground">{t('customers.not_found')}</div>
      </>
    );
  }

  const balanceNum = Number(balance);

  return (
    <>
      <PageHeader title={customer.name} />
      <div className="p-5 space-y-4 animate-fade-in">
        {/* Balance */}
        <Card className={cn(
          'text-center',
          balanceNum < 0 ? 'border-destructive/20 bg-destructive/3' : 'border-emerald-200 bg-emerald-50/50'
        )}>
          <span className="text-sm text-muted-foreground">{t('customers.balance')}</span>
          {balanceNum === 0 ? (
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {t('customers.balance_square')}
            </div>
          ) : (
            <>
              <div className={cn('text-3xl font-bold tabular-nums mt-1', balanceNum < 0 ? 'text-destructive' : 'text-emerald-600')}>
                ₪{Math.abs(balanceNum).toFixed(0)}
              </div>
              <span className={cn('text-sm', balanceNum < 0 ? 'text-destructive/70' : 'text-emerald-600/70')}>
                {balanceNum > 0 ? t('customers.balance_credit') : t('customers.balance_debt')}
              </span>
            </>
          )}
        </Card>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link href={`/miniapp/orders/new?customerId=${customer.id}`}>
            <Card className="flex items-center gap-2 p-3 hover:shadow-md cursor-pointer bg-primary/5 border-primary/15">
              <Plus className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">{t('dash.new_order')}</span>
            </Card>
          </Link>
          <Link href={`/miniapp/payments?customerId=${customer.id}`}>
            <Card className="flex items-center gap-2 p-3 hover:shadow-md cursor-pointer bg-secondary/50">
              <Banknote className="h-4 w-4 text-secondary-foreground" />
              <span className="font-medium text-sm">{t('dash.record_payment')}</span>
            </Card>
          </Link>
        </div>

        {/* Reminder button */}
        {customer.phone && (
          <button
            onClick={() => {
              const link = buildWhatsAppLink(
                customer.phone!,
                t('reminder.message').replace('{name}', customer.name)
              );
              if (!link) {
                toast.error(t('reminder.invalid_phone'));
                return;
              }
              window.open(link, '_blank', 'noopener,noreferrer');
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium text-sm hover:bg-emerald-100 transition-colors active:scale-[0.98]"
          >
            <MessageCircle className="h-4 w-4" />
            {t('reminder.send')}
          </button>
        )}

        {/* Info / Edit */}
        <Card>
          {editing ? (
            <div className="space-y-3">
              <Input label={t('form.customer_name')} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <Input label={t('customers.phone')} value={editPhone} onChange={(e) => setEditPhone(e.target.value)} type="tel" />
              <Input label={t('customers.address')} value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
              <Input label={t('customers.city')} value={editCity} onChange={(e) => setEditCity(e.target.value)} />
              <TextArea label={t('notify.notes')} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={!editName.trim()} loading={saving} onClick={handleSave}>
                  {t('settings.save')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('payments.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="font-semibold">{t('form.customer')}</span>
                <Button variant="ghost" size="sm" onClick={startEditing}>
                  <Pencil className="h-3.5 w-3.5" />
                  {t('customers.edit')}
                </Button>
              </div>
              <div className="space-y-2">
                {customer.phone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('customers.phone')}</span>
                    <span>{customer.phone}</span>
                  </div>
                )}
                {customer.address && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('customers.address')}</span>
                    <span>{customer.address}</span>
                  </div>
                )}
                {customer.city && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('customers.city')}</span>
                    <span>{customer.city}</span>
                  </div>
                )}
                {customer.notes && (
                  <div className="pt-2 border-t border-border text-sm">
                    <span className="text-muted-foreground">{t('notify.notes')}</span>
                    <p className="mt-1">{customer.notes}</p>
                  </div>
                )}
                {!customer.phone && !customer.address && !customer.city && !customer.notes && (
                  <p className="text-sm text-muted-foreground">{t('customers.empty_hint')}</p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Order History */}
        <div>
          <h2 className="font-bold mb-2">{t('customers.order_history')} ({orders.length})</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('orders.empty')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {orders.slice(0, 10).map((o) => {
                const displayStatus = o.status === 'delivered' && !o.paid ? 'to_be_paid' : o.status;
                return (
                  <Link key={o.id} href={`/miniapp/orders/${o.id}`}>
                    <Card className={cn('flex items-center justify-between py-2.5 ps-5 hover:shadow-md transition-shadow border-status-' + displayStatus)}>
                      <div className="text-sm">
                        <div className="flex items-center gap-1.5">
                          {o.isRecurring && <Repeat className="h-3 w-3 text-primary shrink-0" />}
                          <span>{o.itemsSummary}</span>
                        </div>
                        {o.deliveryDate && (
                          <div className="text-muted-foreground">{formatDateRelative(o.deliveryDate, lang)}</div>
                        )}
                      </div>
                      <Badge status={displayStatus} label={translate(`status.${displayStatus}`, lang)} />
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Payment History */}
        <div>
          <h2 className="font-bold mb-2">{t('customers.payment_history')} ({payments.length})</h2>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('orders.empty')}</p>
          ) : (
            <Card className="divide-y divide-border p-0">
              {payments.slice(0, 10).map((p) => (
                <div key={p.id} className="flex justify-between text-sm py-3 px-4">
                  <div>
                    <span className="font-medium">{translate(`payment.${p.type}`, lang)}</span>
                    {p.description && (
                      <span className="text-muted-foreground ms-2">{p.description}</span>
                    )}
                  </div>
                  <span className={cn('font-medium tabular-nums', Number(p.amount) >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                    {Number(p.amount) >= 0 ? '+' : ''}₪{Math.abs(Number(p.amount)).toFixed(0)}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
