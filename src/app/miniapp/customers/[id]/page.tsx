'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT, useLang } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { SendReminderSheet } from '@/components/ui/SendReminderSheet';
import { formatDateRelative } from '@/lib/date-utils';
import { DocketStub, docketWidth } from '@/components/ui/DocketStub';
import { t as translate } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Plus, Banknote, Pencil, Repeat, Trash2, Check, X, MessageCircle, Copy, UserPlus, Send } from 'lucide-react';
import Link from 'next/link';

interface CustomerPhone {
  id: number;
  phone: string;
  name: string | null;
  sortOrder: number;
}

interface Customer {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  notes: string | null;
  reminderOptOut: boolean;
  phones: CustomerPhone[];
}
interface Order { id: number; deliveryDate: string | null; status: string; paid: boolean; isRecurring?: boolean; totalQuantity: number; itemsSummary: string }
interface Payment { id: number; amount: string; type: string; description: string | null; createdAt: string }

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiFetch } = useApi();
  const { activeGroupRole } = useGroup();
  const isAdmin = activeGroupRole !== null && activeGroupRole !== 'baker';
  const t = useT();
  const lang = useLang();
  const toast = useToast();

  const [showSend, setShowSend] = useState<{ customerIds?: number[]; phoneId?: number; count: number } | null>(null);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Phone management state
  const [editingPhoneId, setEditingPhoneId] = useState<number | null>(null);
  const [editPhoneValue, setEditPhoneValue] = useState('');
  const [editPhoneName, setEditPhoneName] = useState('');
  const [newPhoneValue, setNewPhoneValue] = useState('');
  const [newPhoneName, setNewPhoneName] = useState('');
  const [showAddPhone, setShowAddPhone] = useState(false);
  const [sendingContact, setSendingContact] = useState(false);

  function loadData() {
    setLoading(true);
    setError(false);
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
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Normalize an Israeli phone number to international form for wa.me:
  // strip non-digits; if it starts with 0, replace the leading 0 with 972.
  function toIntlPhone(phone: string) {
    const digits = phone.replace(/\D/g, '');
    return digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  }

  async function copyPhone(phone: string) {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success('המספר הועתק');
    } catch {
      toast.error('ההעתקה נכשלה');
    }
  }

  async function sendContactCard(phoneId?: number) {
    setSendingContact(true);
    try {
      await apiFetch(`/customers/${id}/send-contact`, {
        method: 'POST',
        body: JSON.stringify(phoneId ? { phoneId } : {}),
      });
      toast.success('נשלח לצ׳אט — הקישו על הכרטיס כדי לשמור');
    } catch {
      toast.error('שליחת איש הקשר נכשלה');
    } finally {
      setSendingContact(false);
    }
  }

  async function toggleOptOut(next: boolean) {
    try {
      await apiFetch(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reminderOptOut: next }),
      });
      setCustomer((prev) => (prev ? { ...prev, reminderOptOut: next } : prev));
    } catch {
      toast.error(t('customers.save_failed'));
    }
  }

  function startEditing() {
    if (!customer) return;
    setEditName(customer.name);
    setEditAddress(customer.address || '');
    setEditCity(customer.city || '');
    setEditNotes(customer.notes || '');
    setEditing(true);
  }

  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const { customer: updated } = await apiFetch<{ customer: Omit<Customer, 'phones'> }>(
        `/customers/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: editName.trim(),
            address: editAddress || undefined,
            city: editCity || undefined,
            notes: editNotes || undefined,
          }),
        }
      );
      setCustomer((prev) => prev ? { ...prev, ...updated } : prev);
      setEditing(false);
      toast.success(t('customers.saved'));
    } catch {
      toast.error(t('customers.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function addPhone() {
    if (!newPhoneValue.trim() || !customer) return;
    try {
      const { phone } = await apiFetch<{ phone: CustomerPhone }>(
        `/customers/${id}/phones`,
        { method: 'POST', body: JSON.stringify({ phone: newPhoneValue.trim(), name: newPhoneName.trim() || undefined }) }
      );
      setCustomer((prev) => prev ? { ...prev, phones: [...prev.phones, phone] } : prev);
      setNewPhoneValue('');
      setNewPhoneName('');
      setShowAddPhone(false);
    } catch {
      toast.error(t('customers.save_failed'));
    }
  }

  async function savePhone(phoneId: number) {
    if (!editPhoneValue.trim()) return;
    try {
      const { phone } = await apiFetch<{ phone: CustomerPhone }>(
        `/customer-phones/${phoneId}`,
        { method: 'PATCH', body: JSON.stringify({ phone: editPhoneValue.trim(), name: editPhoneName.trim() || null }) }
      );
      setCustomer((prev) => prev ? {
        ...prev,
        phones: prev.phones.map((p) => p.id === phoneId ? phone : p),
      } : prev);
      setEditingPhoneId(null);
    } catch {
      toast.error(t('customers.save_failed'));
    }
  }

  async function deletePhone(phoneId: number) {
    if (!window.confirm('למחוק את המספר?')) return;
    try {
      await apiFetch(`/customer-phones/${phoneId}`, { method: 'DELETE' });
      setCustomer((prev) => prev ? {
        ...prev,
        phones: prev.phones.filter((p) => p.id !== phoneId),
      } : prev);
    } catch {
      toast.error(t('customers.save_failed'));
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

  if (error) {
    return (
      <>
        <PageHeader title={t('form.customer')} />
        <div className="p-5 flex flex-col items-center gap-4 text-center">
          <p className="text-muted-foreground">טעינת הלקוח נכשלה</p>
          <Button variant="outline" loading={loading} onClick={loadData}>
            <Repeat className="h-4 w-4" />
            נסה שוב
          </Button>
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
  const ordW = docketWidth(orders.map((o) => o.id));

  return (
    <>
      <PageHeader title={customer.name} />
      <div className="p-5 space-y-4 animate-fade-in">
        {/* Balance */}
        <Card className={cn(
          'text-center',
          balanceNum < 0 ? 'border-destructive/20 bg-destructive/3' : 'border-success/30 bg-success/10'
        )}>
          <span className="text-sm text-muted-foreground">{t('customers.balance')}</span>
          {balanceNum === 0 ? (
            <div className="text-2xl font-bold text-success mt-1">
              {t('customers.balance_square')}
            </div>
          ) : (
            <>
              <div className={cn('text-3xl font-bold tabular-nums mt-1', balanceNum < 0 ? 'text-destructive' : 'text-success')}>
                ₪{Math.abs(balanceNum).toFixed(0)}
              </div>
              <span className={cn('text-sm', balanceNum < 0 ? 'text-destructive/70' : 'text-success/70')}>
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

        {/* Phones — manage inline (always visible, independent of edit drawer) */}
        <Card className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">{t('customers.phones')}</span>
            <div className="flex items-center gap-1">
              {isAdmin && customer.phones.length > 0 && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  aria-label={t('reminders.send')}
                  title={customer.reminderOptOut ? t('reminders.opt_out_on') : t('reminders.send')}
                  disabled={customer.reminderOptOut}
                  onClick={() => setShowSend({ customerIds: [customer.id], count: customer.phones.length })}
                >
                  <Send className="h-4 w-4 text-primary" />
                </Button>
              )}
              {customer.phones.length > 0 && (
                <Button size="sm" variant="ghost" loading={sendingContact} onClick={() => sendContactCard()}>
                  <UserPlus className="h-4 w-4" />
                  שמור אנשי קשר
                </Button>
              )}
            </div>
          </div>
          {customer.phones.length === 0 && !showAddPhone && (
            <p className="text-xs text-muted-foreground italic">{t('customers.no_phones')}</p>
          )}
          {customer.phones.map((p) => (
            editingPhoneId === p.id ? (
              <div key={p.id} className="space-y-2">
                <Input
                  value={editPhoneName}
                  onChange={(e) => setEditPhoneName(e.target.value)}
                  placeholder="שם (לא חובה)"
                />
                <div className="flex items-center gap-2">
                  <Input
                    type="tel"
                    value={editPhoneValue}
                    onChange={(e) => setEditPhoneValue(e.target.value)}
                    className="flex-1"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => savePhone(p.id)}>
                    <Check className="h-4 w-4 text-success" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setEditingPhoneId(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  {p.name && <div className="text-xs text-muted-foreground truncate">{p.name}</div>}
                  <button
                    type="button"
                    onClick={() => copyPhone(p.phone)}
                    className="tabular-nums text-primary inline-flex min-h-[44px] items-center gap-1.5 hover:underline"
                    dir="ltr"
                    aria-label={`העתק מספר ${p.phone}`}
                    title="העתק מספר"
                  >
                    {p.phone}
                    <Copy className="h-3.5 w-3.5 opacity-50" />
                  </button>
                </div>
                <div className="flex gap-1 shrink-0">
                  {isAdmin && (
                    <button
                      type="button"
                      aria-label={t('reminders.send')}
                      title={customer.reminderOptOut ? t('reminders.opt_out_on') : t('reminders.send')}
                      disabled={customer.reminderOptOut}
                      onClick={() => setShowSend({ phoneId: p.id, count: 1 })}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-primary transition-all duration-150 hover:bg-primary/10 active:scale-[0.98] disabled:opacity-30"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  )}
                  <a
                    href={`https://wa.me/${toIntlPhone(p.phone)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="WhatsApp"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-success transition-all duration-150 hover:bg-success/10 active:scale-[0.98]"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </a>
                  <Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => { setEditingPhoneId(p.id); setEditPhoneValue(p.phone); setEditPhoneName(p.name ?? ''); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-11 w-11 text-destructive hover:bg-destructive/10" onClick={() => deletePhone(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          ))}
          {showAddPhone ? (
            <div className="space-y-2">
              <Input
                value={newPhoneName}
                onChange={(e) => setNewPhoneName(e.target.value)}
                placeholder="שם (לא חובה)"
              />
              <div className="flex items-center gap-2">
                <Input
                  type="tel"
                  value={newPhoneValue}
                  onChange={(e) => setNewPhoneValue(e.target.value)}
                  placeholder="050-1234567"
                  className="flex-1"
                  autoFocus
                />
                <Button size="icon" variant="ghost" className="h-9 w-9" disabled={!newPhoneValue.trim()} onClick={addPhone}>
                  <Check className="h-4 w-4 text-success" />
                </Button>
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => { setShowAddPhone(false); setNewPhoneValue(''); setNewPhoneName(''); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowAddPhone(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t('customers.add_phone')}
            </Button>
          )}
          {isAdmin && (
            <label className="flex items-center gap-2 pt-2.5 mt-1 border-t border-border text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={customer.reminderOptOut}
                onChange={(e) => toggleOptOut(e.target.checked)}
                className="h-4 w-4 accent-primary cursor-pointer"
              />
              <span className={customer.reminderOptOut ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                {t('reminders.opt_out')}
              </span>
            </label>
          )}
        </Card>

        {/* Info / Edit — name, address, city, notes only (phones managed above) */}
        <Card>
          {editing ? (
            <div className="space-y-3">
              <Input label={t('form.customer_name')} value={editName} onChange={(e) => setEditName(e.target.value)} />
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
                {!customer.address && !customer.city && !customer.notes && (
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
            <Card className="p-0 overflow-hidden">
              {orders.slice(0, 10).map((o, idx) => {
                const displayStatus = o.status === 'delivered' && !o.paid ? 'to_be_paid' : o.status;
                return (
                  <Link key={o.id} href={`/miniapp/orders/${o.id}`}>
                    <div className={cn(
                      'flex items-stretch transition-colors hover:bg-muted/40',
                      idx > 0 && 'border-t border-dashed border-border'
                    )}>
                      <DocketStub id={o.id} width={ordW} />
                      <div className="flex flex-1 items-center gap-3 px-3 py-3 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium flex items-center gap-1.5 line-clamp-1">
                            {o.isRecurring && (
                              <Repeat className="h-3 w-3 text-primary shrink-0" aria-label="הזמנה קבועה" role="img">
                                <title>הזמנה קבועה</title>
                              </Repeat>
                            )}
                            <span className="truncate">{o.itemsSummary}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge status={displayStatus} label={translate(`status.${displayStatus}`, lang)} />
                          <div className="flex items-center gap-1.5">
                            {o.status !== 'delivered' && !o.paid && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-warning/10 text-warning">
                                {t('orders.not_yet_paid')}
                              </span>
                            )}
                            {o.deliveryDate && (
                              <span className="text-xs text-muted-foreground">{formatDateRelative(o.deliveryDate, lang)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </Card>
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
                  <span className={cn('font-medium tabular-nums', Number(p.amount) >= 0 ? 'text-success' : 'text-destructive')}>
                    {Number(p.amount) >= 0 ? '+' : ''}₪{Math.abs(Number(p.amount)).toFixed(0)}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
      {showSend && (
        <SendReminderSheet
          count={showSend.count}
          customerIds={showSend.customerIds}
          phoneId={showSend.phoneId}
          onClose={() => setShowSend(null)}
        />
      )}
    </>
  );
}
