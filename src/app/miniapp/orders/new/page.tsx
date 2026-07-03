'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import { Search, UserPlus, Minus, Plus, Trash2, Calendar, Zap, CalendarDays, Repeat, Check, Truck } from 'lucide-react';
import { getInitial } from '@/lib/name-utils';
import { classifyCity, resolveDeliveryFee, type DeliverySettings } from '@/lib/delivery';
import { computeOrderPricing } from '@/lib/pricing';
import { formatAllocation } from '@/lib/pricing-format';
import { Tag } from 'lucide-react';

interface Customer { id: number; name: string; city?: string | null; phones?: { id: number; phone: string }[] }
interface BreadSize { id: number; name: string; weightGrams: number | null; price: string; tiers?: Record<number, number> }
interface BreadAddition { id: number; name: string }
interface BreadType { id: number; name: string; enabledSizes?: BreadSize[]; enabledAdditions?: BreadAddition[] }
interface LineItem { breadTypeId: number; breadSizeId: number | null; breadAdditionIds: number[]; quantity: number }

type DeliveryType = 'shabbat' | 'asap' | 'specific_date' | 'weekly';

export default function NewOrderPage() {
  return (
    <Suspense fallback={
      <div className="p-5 space-y-4">
        <div className="h-10 rounded-xl bg-muted animate-pulse" />
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      </div>
    }>
      <OrderFormContent />
    </Suspense>
  );
}

const deliveryIcons: Record<DeliveryType, typeof Calendar> = {
  shabbat: Calendar,
  asap: Zap,
  specific_date: CalendarDays,
  weekly: Repeat,
};

function OrderFormContent() {
  const { apiFetch } = useApi();
  const { activeGroupId, activeGroupRole } = useGroup();
  const isAdmin = (activeGroupRole === 'owner' || activeGroupRole === 'manager');
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT();
  const toast = useToast();

  const editId = searchParams.get('edit');
  const presetCustomerId = searchParams.get('customerId');
  const isEdit = !!editId;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [breadTypes, setBreadTypes] = useState<BreadType[]>([]);
  const [additionsSurcharge, setAdditionsSurcharge] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [customerId, setCustomerId] = useState<number | null>(
    presetCustomerId ? Number(presetCustomerId) : null
  );
  const [customerName, setCustomerName] = useState('');
  const [items, setItems] = useState<LineItem[]>([]);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('shabbat');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [totalOverride, setTotalOverride] = useState('');
  const [dealsEnabled, setDealsEnabled] = useState(true);
  const [additionsCharged, setAdditionsCharged] = useState(true);
  const [isRecurring, setIsRecurring] = useState(false);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [isDelivery, setIsDelivery] = useState(false);
  const [deliveryManualFee, setDeliveryManualFee] = useState('');
  const [delivSettings, setDelivSettings] = useState<DeliverySettings | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [addSizeForIdx, setAddSizeForIdx] = useState<number | null>(null);
  const [newSizeName, setNewSizeName] = useState('');
  const [newSizeWeight, setNewSizeWeight] = useState('');
  const [newSizePrice, setNewSizePrice] = useState('');
  const [addingSize, setAddingSize] = useState(false);

  useEffect(() => {
    const loads: Promise<unknown>[] = [
      apiFetch<{ customers: Customer[] }>('/customers'),
      apiFetch<{ breadTypes: BreadType[] }>('/bread-types'),
    ];

    if (activeGroupId) {
      loads.push(apiFetch<{ group: { additionsSurcharge: string } }>(`/groups/${activeGroupId}`));
    } else {
      loads.push(Promise.resolve({ group: { additionsSurcharge: '0' } }));
    }

    if (isEdit) {
      loads.push(apiFetch<{ order: { customerId: number; customerName: string; deliveryType: string; deliveryDate: string | null; notes: string | null; status: string; items: { breadTypeId: number; breadSizeId: number | null; quantity: number }[] } }>(`/orders/${editId}`));
    }

    Promise.all(loads)
      .then(([c, b, g, o]: any[]) => {
        setCustomers(c.customers);
        setBreadTypes(b.breadTypes);
        setAdditionsSurcharge(Number(g?.group?.additionsSurcharge ?? 0));
        setDelivSettings({
          enabled: Boolean(g?.group?.deliveryEnabled),
          homeCity: g?.group?.deliveryHomeCity ?? null,
          fee: Number(g?.group?.deliveryFee ?? 0),
          freeOver: g?.group?.deliveryFreeOver != null ? Number(g.group.deliveryFreeOver) : null,
          cities: g?.group?.deliveryCities ?? [],
        });

        if (isEdit && o?.order) {
          const order = o.order;
          if (order.status === 'delivered' || order.status === 'cancelled') {
            router.replace(`/miniapp/orders/${editId}`);
            return;
          }
          setCustomerId(order.customerId);
          setCustomerName(order.customerName);
          setItems(order.items.map((i: { breadTypeId: number; breadSizeId: number | null; quantity: number; additions?: { id: number }[] }) => ({
            breadTypeId: i.breadTypeId,
            breadSizeId: i.breadSizeId ?? null,
            breadAdditionIds: (i.additions ?? []).map((a) => a.id),
            quantity: i.quantity,
          })));
          setDeliveryType(order.deliveryType as DeliveryType);
          setDeliveryDate(order.deliveryDate || '');
          setNotes(order.notes || '');
          setTotalOverride(order.totalOverride ? String(Number(order.totalOverride)) : '');
          setIsRecurring(Boolean((order as { isRecurring?: boolean }).isRecurring));
          setDealsEnabled((order as { dealsEnabled?: boolean }).dealsEnabled ?? true);
          setAdditionsCharged((order as { additionsCharged?: boolean }).additionsCharged ?? true);
          setIsDelivery(Boolean(order.isDelivery));
          setDeliveryManualFee(
            order.deliveryFee && Number(order.deliveryFee) > 0 ? String(Number(order.deliveryFee)) : ''
          );
        } else if (!isEdit && b.breadTypes.length > 0) {
          const firstType = b.breadTypes[0];
          const defaultSize = firstType.enabledSizes?.[0];
          setItems([{ breadTypeId: firstType.id, breadSizeId: defaultSize?.id ?? null, breadAdditionIds: [], quantity: 1 }]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Auto-suggest delivery when the selected customer's city changes (create mode).
  useEffect(() => {
    if (isEdit || !delivSettings) return;
    const cust = customers.find((c) => c.id === customerId);
    setIsDelivery(classifyCity(cust?.city ?? null, delivSettings).available);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, delivSettings, customers]);

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase())
  );

  function updateItem(index: number, update: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...update } : item))
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    if (breadTypes.length === 0) return;
    const firstType = breadTypes[0];
    const defaultSize = firstType.enabledSizes?.[0];
    setItems((prev) => [...prev, { breadTypeId: firstType.id, breadSizeId: defaultSize?.id ?? null, breadAdditionIds: [], quantity: 1 }]);
  }

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

  function openAddSize(idx: number) {
    setAddSizeForIdx(idx);
    setNewSizeName('');
    setNewSizeWeight('');
    setNewSizePrice('');
  }

  function cancelAddSize() {
    setAddSizeForIdx(null);
    setNewSizeName('');
    setNewSizeWeight('');
    setNewSizePrice('');
  }

  // Create a size on the fly and enable it for the bread type being ordered, then
  // select it for this line item. Two calls: create the global size, then additively
  // link it to the type (keeps the type's other sizes and price overrides intact).
  async function handleCreateSize(idx: number) {
    const item = items[idx];
    if (!item || !newSizeName.trim() || !newSizePrice || !activeGroupId) return;
    setAddingSize(true);
    try {
      const { size } = await apiFetch<{ size: BreadSize }>(
        `/groups/${activeGroupId}/bread-sizes`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: newSizeName.trim(),
            weightGrams: newSizeWeight ? Number(newSizeWeight) : null,
            price: newSizePrice,
          }),
        }
      );
      await apiFetch(`/groups/${activeGroupId}/bread-types/${item.breadTypeId}/sizes`, {
        method: 'POST',
        body: JSON.stringify({ breadSizeId: size.id }),
      });
      setBreadTypes((prev) =>
        prev.map((bt) =>
          bt.id === item.breadTypeId
            ? {
                ...bt,
                enabledSizes: [
                  ...(bt.enabledSizes ?? []),
                  { id: size.id, name: size.name, weightGrams: size.weightGrams, price: size.price },
                ],
              }
            : bt
        )
      );
      updateItem(idx, { breadSizeId: size.id });
      cancelAddSize();
      toast.success(t('form.size_added'));
    } catch {
      toast.error(t('form.size_add_failed'));
    } finally {
      setAddingSize(false);
    }
  }

  async function handleSubmit() {
    if (!customerId || items.length === 0) return;
    setSubmitting(true);
    try {
      if (isEdit) {
        await apiFetch(`/orders/${editId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            deliveryType,
            deliveryDate: deliveryType === 'specific_date' ? deliveryDate : undefined,
            items,
            notes: notes || undefined,
            totalOverride: totalOverride || null,
            isDelivery,
            deliveryFee: effectiveFee.toFixed(2),
            isRecurring,
            dealsEnabled,
            additionsCharged,
          }),
        });
        toast.success(t('orders.updated'));
        router.push(`/miniapp/orders/${editId}`);
      } else {
        await apiFetch('/orders', {
          method: 'POST',
          body: JSON.stringify({
            customerId,
            deliveryType,
            deliveryDate: deliveryType === 'specific_date' ? deliveryDate : undefined,
            items,
            notes: notes || undefined,
            totalOverride: totalOverride || null,
            isDelivery,
            deliveryFee: effectiveFee.toFixed(2),
            isRecurring,
            dealsEnabled,
            additionsCharged,
            notifyCustomer,
          }),
        });
        toast.success(t('orders.created'));
        router.push('/miniapp');
      }
    } catch {
      toast.error(isEdit ? t('orders.update_failed') : t('orders.create_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={isEdit ? t('orders.edit') : t('orders.new_order')} />
        <div className="p-5 space-y-4">
          <div className="h-24 rounded-xl bg-muted animate-pulse" />
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
          <div className="h-20 rounded-xl bg-muted animate-pulse" />
        </div>
      </>
    );
  }

  const selectedCustomer = isEdit
    ? { id: customerId!, name: customerName }
    : customers.find((c) => c.id === customerId);

  // Live order total via the shared pricing engine, so the owner sees the exact
  // bulk-deal price the server will charge (breakdown included).
  const pricedLines = items
    .map((item) => {
      const type = breadTypes.find((bt) => bt.id === item.breadTypeId);
      const size = type?.enabledSizes?.find((s) => s.id === item.breadSizeId);
      return size ? { item, size } : null;
    })
    .filter((x): x is { item: LineItem; size: BreadSize } => x !== null);
  const hasPricedItem = pricedLines.length > 0;
  const tierQtysBySize: Record<number, number[]> = {};
  for (const { size } of pricedLines) {
    const qtys = Object.keys(size.tiers ?? {}).map(Number);
    if (qtys.length) tierQtysBySize[size.id] = qtys;
  }
  const livePricing = computeOrderPricing({
    lines: pricedLines.map(({ item, size }) => ({
      breadTypeId: item.breadTypeId,
      breadSizeId: item.breadSizeId,
      quantity: item.quantity,
      unitPrice: Number(size.price),
      hasAdditions: item.breadAdditionIds.length > 0,
      tierPrices: size.tiers ?? {},
    })),
    tierQtysBySize,
    surcharge: additionsSurcharge,
    chargeAdditions: additionsCharged,
    dealsEnabled,
    deliveryFee: 0,
    totalOverride: null,
  });
  const liveTotal = livePricing.goods;
  const hasDeal = livePricing.rows.some((r) => r.kind === 'pack');

  // Delivery: classify the customer's city + resolve the fee live.
  const custCity = customers.find((c) => c.id === customerId)?.city ?? null;
  const deliveryAvailable = delivSettings
    ? classifyCity(custCity, delivSettings).available
    : false;
  const computedFee = delivSettings
    ? resolveDeliveryFee({
        city: custCity,
        subtotal: liveTotal,
        settings: delivSettings,
        manualFee: Number(deliveryManualFee || 0),
      })
    : Number(deliveryManualFee || 0);
  const effectiveFee = isDelivery ? computedFee : 0;

  // Earliest selectable delivery date (today, local time) as yyyy-MM-dd
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  const deliveryOptions: [DeliveryType, string][] = [
    ['shabbat', t('delivery.shabbat')],
    ['asap', t('delivery.asap')],
    ['specific_date', t('delivery.specific_date')],
    ['weekly', t('delivery.weekly')],
  ];

  return (
    <>
      <PageHeader title={isEdit ? t('orders.edit') : t('orders.new_order')} />
      <div className="p-5 space-y-4 animate-fade-in">
        {/* Customer */}
        <Card>
          <h3 className="font-semibold mb-3">{t('form.customer')}</h3>
          {isEdit ? (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                {getInitial(customerName)}
              </div>
              <span className="font-medium">{customerName}</span>
            </div>
          ) : customerId ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                  {getInitial(selectedCustomer?.name ?? '')}
                </div>
                <span className="font-medium">{selectedCustomer?.name}</span>
                <Check className="h-4 w-4 text-success" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCustomerId(null)}>
                {t('form.change')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-input bg-card ps-9 pe-3 py-2.5 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground/50"
                  placeholder={t('form.search_customer')}
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-start px-3 py-2.5 rounded-lg hover:bg-muted transition-colors flex items-center gap-2"
                    onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }}
                  >
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {getInitial(c.name)}
                    </div>
                    {c.name}
                  </button>
                ))}
              </div>
              {!showNewCustomer ? (
                <Button variant="ghost" size="sm" onClick={() => setShowNewCustomer(true)}>
                  <UserPlus className="h-4 w-4" />
                  {t('form.add_customer')}
                </Button>
              ) : (
                <div className="flex gap-2 animate-expand">
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

        {/* Line Items */}
        <Card>
          <h3 className="font-semibold mb-3">{t('form.bread_type')}</h3>
          <div className="space-y-3">
            {items.map((item, idx) => {
              const selectedType = breadTypes.find((bt) => bt.id === item.breadTypeId);
              const sizes = selectedType?.enabledSizes ?? [];
              return (
                <div
                  key={idx}
                  className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-2.5"
                >
                  {/* Bread type — primary, full width */}
                  <select
                    className="w-full rounded-lg border border-input bg-card px-3 py-3 text-base font-medium outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={item.breadTypeId}
                    onChange={(e) => {
                      const newTypeId = Number(e.target.value);
                      const newType = breadTypes.find((bt) => bt.id === newTypeId);
                      const defaultSize = newType?.enabledSizes?.[0];
                      updateItem(idx, { breadTypeId: newTypeId, breadSizeId: defaultSize?.id ?? null, breadAdditionIds: [] });
                    }}
                  >
                    {breadTypes.map((bt) => (
                      <option key={bt.id} value={bt.id}>
                        {bt.name}
                      </option>
                    ))}
                  </select>

                  {/* Size chips — secondary */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {sizes.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={cn(
                          'px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border',
                          item.breadSizeId === s.id
                            ? 'bg-primary/10 border-primary/30 text-primary shadow-sm'
                            : 'bg-card border-border hover:bg-muted text-muted-foreground'
                        )}
                        onClick={() => updateItem(idx, { breadSizeId: s.id })}
                      >
                        {s.name}
                        {s.weightGrams != null && (
                          <span className="tabular-nums opacity-70"> {s.weightGrams}g</span>
                        )}
                        <span className="tabular-nums opacity-70"> ₪{s.price}</span>
                      </button>
                    ))}
                    {isAdmin && addSizeForIdx !== idx && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border border-dashed border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary transition-all hover:bg-primary/5 active:scale-95"
                        onClick={() => openAddSize(idx)}
                      >
                        <Plus className="h-3 w-3" />
                        {t('form.add_size')}
                      </button>
                    )}
                    {sizes.length === 0 && !isAdmin && (
                      <span className="px-1 py-1.5 text-xs text-destructive/80">
                        {t('form.no_sizes_for_type')}
                      </span>
                    )}
                  </div>

                  {/* Inline create-size form (admin only) */}
                  {isAdmin && addSizeForIdx === idx && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-2 animate-expand">
                      <Input
                        autoFocus
                        placeholder={t('form.size_name')}
                        value={newSizeName}
                        onChange={(e) => setNewSizeName(e.target.value)}
                        className="flex-1 min-w-[5rem]"
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        placeholder={t('form.size_weight')}
                        value={newSizeWeight}
                        onChange={(e) => setNewSizeWeight(e.target.value)}
                        className="w-[4.5rem]"
                      />
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder={t('form.size_price')}
                        value={newSizePrice}
                        onChange={(e) => setNewSizePrice(e.target.value)}
                        className="w-[4.5rem]"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleCreateSize(idx)}
                        loading={addingSize}
                        disabled={!newSizeName.trim() || !newSizePrice}
                      >
                        {t('form.add')}
                      </Button>
                      <button
                        type="button"
                        className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={cancelAddSize}
                      >
                        {t('form.cancel')}
                      </button>
                    </div>
                  )}

                  {/* Additions — multi-select chips */}
                  {(selectedType?.enabledAdditions?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1.5 px-1 flex items-center gap-1.5">
                        <span>{t('form.additions')}</span>
                        {additionsSurcharge > 0 && item.breadAdditionIds.length > 0 && (
                          additionsCharged ? (
                            <span className="text-primary tabular-nums">+₪{additionsSurcharge}</span>
                          ) : (
                            <span className="text-muted-foreground/60 line-through tabular-nums">+₪{additionsSurcharge}</span>
                          )
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedType!.enabledAdditions!.map((a) => {
                          const selected = item.breadAdditionIds.includes(a.id);
                          return (
                            <button
                              key={a.id}
                              type="button"
                              className={cn(
                                'px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border',
                                selected
                                  ? 'bg-primary/10 border-primary/30 text-primary shadow-sm'
                                  : 'bg-card border-border hover:bg-muted text-muted-foreground'
                              )}
                              onClick={() => {
                                const next = selected
                                  ? item.breadAdditionIds.filter((id) => id !== a.id)
                                  : [...item.breadAdditionIds, a.id];
                                updateItem(idx, { breadAdditionIds: next });
                              }}
                            >
                              {a.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stepper + delete — tertiary controls row */}
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 shadow-sm">
                      <button
                        type="button"
                        aria-label="decrease"
                        className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all"
                        onClick={() => updateItem(idx, { quantity: Math.max(1, item.quantity - 1) })}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-10 text-center font-bold tabular-nums text-base">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="increase"
                        className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all"
                        onClick={() => updateItem(idx, { quantity: item.quantity + 1 })}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex-1" />
                    {items.length > 1 && (
                      <button
                        type="button"
                        aria-label="remove item"
                        className="w-10 h-10 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-all active:scale-95"
                        onClick={() => removeItem(idx)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" className="mt-3" onClick={addItem}>
            <Plus className="h-4 w-4" />
            {t('form.add')}
          </Button>
        </Card>

        {/* Delivery */}
        <Card>
          <h3 className="font-semibold mb-3">{t('form.delivery')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {deliveryOptions.map(([type, label]) => {
              const Icon = deliveryIcons[type];
              return (
                <button
                  key={type}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all border',
                    deliveryType === type
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-card border-border hover:bg-muted text-foreground'
                  )}
                  onClick={() => setDeliveryType(type)}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
          {deliveryType === 'specific_date' && (
            <Input
              type="date"
              value={deliveryDate}
              min={todayIso}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="mt-3"
            />
          )}
          {deliveryType !== 'asap' && (
            <label className="mt-3 flex items-start gap-2.5 cursor-pointer p-2.5 -mx-2.5 rounded-lg hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Repeat className="h-3.5 w-3.5" />
                  {t('orders.repeat_weekly')}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('orders.repeat_weekly_hint')}
                </div>
              </div>
            </label>
          )}
        </Card>

        {/* Delivery (pickup vs delivery) */}
        {delivSettings?.enabled && (
          <Card className="space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isDelivery}
                onChange={(e) => setIsDelivery(e.target.checked)}
                className="h-4 w-4 accent-primary cursor-pointer"
              />
              <span className="flex items-center gap-1.5 font-semibold">
                <Truck className="h-4 w-4 text-primary" />
                {t('deliv.checkbox')}
              </span>
            </label>

            {!isDelivery && !deliveryAvailable && custCity && (
              <p className="text-xs text-muted-foreground">{t('deliv.no_city')}</p>
            )}

            {isDelivery &&
              (deliveryAvailable ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('deliv.fee_label')}</span>
                  <span className="font-mono font-bold tabular-nums">
                    {effectiveFee === 0 ? t('deliv.free') : `₪${effectiveFee}`}
                  </span>
                </div>
              ) : (
                <Input
                  label={t('deliv.fee_label')}
                  type="number"
                  inputMode="decimal"
                  value={deliveryManualFee}
                  onChange={(e) => setDeliveryManualFee(e.target.value)}
                  placeholder="0"
                />
              ))}
          </Card>
        )}

        {/* Notes & Custom Total */}
        <Card className="space-y-3 p-4">
          <TextArea
            label={t('form.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('form.notes_placeholder')}
          />
          <Input
            label={t('form.custom_total')}
            type="number"
            inputMode="decimal"
            value={totalOverride}
            onChange={(e) => setTotalOverride(e.target.value)}
            placeholder="0"
          />
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={dealsEnabled}
              onChange={(e) => setDealsEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Tag className="h-3.5 w-3.5" />
                {t('order.deals_label')}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{t('order.deals_hint')}</div>
            </div>
          </label>
          {additionsSurcharge > 0 && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={additionsCharged}
                onChange={(e) => setAdditionsCharged(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Plus className="h-3.5 w-3.5" />
                  {t('order.charge_additions')}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{t('order.charge_additions_hint')}</div>
              </div>
            </label>
          )}
        </Card>

        {/* Notify customer (only on create, only if customer has at least one phone) */}
        {!isEdit && selectedCustomer && (selectedCustomer as Customer).phones && ((selectedCustomer as Customer).phones?.length ?? 0) > 0 && (
          <label className="flex items-start gap-2.5 cursor-pointer p-2.5 rounded-lg hover:bg-muted/50 transition-colors">
            <input
              type="checkbox"
              checked={notifyCustomer}
              onChange={(e) => setNotifyCustomer(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
            />
            <span className="text-sm font-medium">{t('notify.send_whatsapp')}</span>
          </label>
        )}

        {/* Sticky submit footer — stays above the fixed bottom nav */}
        <div className="sticky bottom-14 -mx-5 -mb-4 mt-4 border-t border-border bg-card/95 px-5 py-3 backdrop-blur-md">
          {hasPricedItem && (
            <div className="mb-2.5 space-y-1">
              {hasDeal && !totalOverride &&
                livePricing.rows.map((row, idx) => {
                  const f = formatAllocation(row, t);
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs text-muted-foreground"
                    >
                      <span>{f.label}</span>
                      <span className="font-mono tabular-nums">₪{f.amount}</span>
                    </div>
                  );
                })}
              {isDelivery && effectiveFee > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('deliv.fee_label')}</span>
                  <span className="font-mono tabular-nums">₪{effectiveFee}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('orders.total')}</span>
                <span className="font-mono text-lg font-bold tabular-nums text-primary">
                  ₪{(totalOverride ? Number(totalOverride) : liveTotal) + effectiveFee}
                </span>
              </div>
            </div>
          )}
          <Button
            className="w-full"
            size="lg"
            disabled={
              !customerId ||
              items.length === 0 ||
              items.some((i) => !i.breadSizeId) ||
              (deliveryType === 'specific_date' && !deliveryDate)
            }
            loading={submitting}
            onClick={handleSubmit}
          >
            {isEdit ? t('form.update_order') : t('form.create_order')}
          </Button>
        </div>
      </div>
    </>
  );
}
