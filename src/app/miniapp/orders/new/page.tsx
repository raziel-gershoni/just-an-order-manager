'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn, friendlyError } from '@/lib/utils';
import { Search, UserPlus, Minus, Plus, Trash2, Calendar, Zap, CalendarDays, Repeat, Check, Truck, CalendarClock, CopyPlus, AlertTriangle } from 'lucide-react';
import { getInitial } from '@/lib/name-utils';
import { classifyCity, resolveDeliveryFee, type DeliverySettings } from '@/lib/delivery';
import { computeOrderPricing } from '@/lib/pricing';
import { formatAllocation } from '@/lib/pricing-format';
import { Tag } from 'lucide-react';
import { pricingKey } from '@/lib/order-fingerprint';
import { dayAfter, formatDayMonth, formatWeekdayShort, fridayOfWeek, rollWeeklyPast } from '@/lib/date-utils';
import { isFridayType, type NextChangeSection, type NextOccurrenceView } from '@/lib/order-next-change-types';
import { NextChangeConflictSheet, sectionsLabel } from '@/components/orders/NextChangeConflictSheet';
import { copyLinesToMenu, type SourceLine } from '@/lib/order-copy';

interface Customer { id: number; name: string; city?: string | null; phones?: { id: number; phone: string; hasWhatsapp?: boolean }[] }
interface BreadSize { id: number; name: string; weightGrams: number | null; price: string; tiers?: Record<number, number> }
interface BreadAddition { id: number; name: string }
interface BreadType { id: number; name: string; enabledSizes?: BreadSize[]; enabledAdditions?: BreadAddition[] }
interface LineItem { breadTypeId: number; breadSizeId: number | null; breadAdditionIds: number[]; quantity: number; additionsCharged?: boolean | null }

type DeliveryType = 'shabbat' | 'asap' | 'specific_date' | 'weekly';

/** A basket whose goods are already frozen, and what they come to. */
interface Baseline { key: string; goods: number }

/** A saved order as GET /orders/[id] returns it: what edit, next mode and a copy read. */
interface SavedOrder {
  id: number;
  customerId: number;
  customerName: string;
  deliveryType: string;
  deliveryDate: string | null;
  notes: string | null;
  status: string;
  isRecurring?: boolean;
  isDelivery?: boolean;
  deliveryFee?: string | number | null;
  totalOverride?: string | null;
  dealsEnabled?: boolean;
  additionsCharged?: boolean;
  calculatedTotal?: number;
  nextOccurrence?: NextOccurrenceView | null;
  items: SourceLine[];
}

interface GroupSettings {
  group?: {
    additionsSurcharge?: string;
    deliveryEnabled?: boolean;
    deliveryHomeCity?: string | null;
    deliveryFee?: string | number;
    deliveryFreeOver?: string | number | null;
    deliveryCities?: string[];
  };
}

/** What a plain edit was loaded with, to tell which parts of the order it changed. */
interface Loaded {
  notes: string;
  totalOverride: string;
  isDelivery: boolean;
  manualFee: string;
  deliveryType: DeliveryType;
  deliveryDate: string;
}

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
  // "From the next occurrence": the same form, saving what the next order of a
  // recurring chain changes, while this one stays as it is.
  const isNext = isEdit && searchParams.get('next') === '1';
  // "Order again": a new order that starts as a copy of a saved one.
  const copyFromId = isEdit ? null : searchParams.get('from');

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
  // The baskets whose prices are frozen — this order's, and in next mode also
  // the waiting change's — for telling a real item edit from a notes/date/fee
  // one. The server draws the same line before it re-prices, and the two have
  // to agree or the fee is judged on the wrong basket.
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [orderDate, setOrderDate] = useState<string | null>(null);
  const [nextOcc, setNextOcc] = useState<NextOccurrenceView | null>(null);
  const [conflict, setConflict] = useState<NextChangeSection[] | null>(null);
  const [copiedFrom, setCopiedFrom] = useState<{ id: number; date: string | null; customerId: number; dropped: boolean; none: boolean; droppedTotal: boolean } | null>(null);
  // A copy's own pickup or delivery choice holds until the customer is changed.
  const copyHold = useRef(false);
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
      loads.push(apiFetch<GroupSettings>(`/groups/${activeGroupId}`));
    } else {
      loads.push(Promise.resolve({ group: { additionsSurcharge: '0' } }));
    }

    if (isEdit) {
      loads.push(apiFetch<{ order: SavedOrder }>(`/orders/${editId}`));
    } else if (copyFromId) {
      // Its own catch: an order that can't be read leaves a blank new order,
      // not a form that never loads.
      loads.push(
        apiFetch<{ order: SavedOrder }>(`/orders/${copyFromId}`).catch((e) => {
          console.error(`Order again: failed to load order ${copyFromId}`, e);
          toast.error(t('orders.copy_failed'));
          return null;
        })
      );
    }

    Promise.all(loads)
      .then((loaded) => {
        const [c, b, g, o] = loaded as [
          { customers: Customer[] },
          { breadTypes: BreadType[] },
          GroupSettings,
          { order: SavedOrder } | null | undefined,
        ];
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
        const money = (v: string | number | null | undefined) => (v != null && Number(v) > 0 ? String(Number(v)) : '');

        if (isEdit && o?.order) {
          const order = o.order;
          if (order.status === 'delivered' || order.status === 'cancelled') {
            router.replace(`/miniapp/orders/${editId}`);
            return;
          }
          const occ: NextOccurrenceView | null = order.nextOccurrence ?? null;
          // Next mode needs an open recurring order to plan on; anything else
          // (stopped meanwhile, an old link) goes back to the order itself.
          if (isNext && !occ) {
            router.replace(`/miniapp/orders/${editId}`);
            return;
          }
          setNextOcc(occ);
          setOrderDate(order.deliveryDate ?? null);
          setCustomerId(order.customerId);
          setCustomerName(order.customerName);
          const orderItems: LineItem[] = order.items.map((i: { breadTypeId: number; breadSizeId: number | null; quantity: number; additions?: { id: number }[]; additionsCharged?: boolean | null }) => ({
            breadTypeId: i.breadTypeId,
            breadSizeId: i.breadSizeId ?? null,
            breadAdditionIds: (i.additions ?? []).map((a) => a.id),
            quantity: i.quantity,
            additionsCharged: i.additionsCharged ?? null,
          }));
          const orderDeals: boolean = order.dealsEnabled ?? true;
          const orderAdditions: boolean = order.additionsCharged ?? true;
          // The goods this order is actually charged for, frozen when it was
          // placed. The free-delivery threshold has to be judged against that,
          // not against what the same basket would cost at today's prices.
          const frozen: Baseline[] =
            typeof order.calculatedTotal === 'number'
              ? [{ key: pricingKey(orderItems, orderDeals, orderAdditions), goods: order.calculatedTotal }]
              : [];

          // In next mode each part starts from the waiting change when it holds
          // that part, else from this order — what the next one would be.
          const plan = isNext ? occ?.change ?? null : null;
          const basket = plan?.basket;
          if (basket) {
            const planItems: LineItem[] = basket.items.map((i) => ({
              breadTypeId: i.breadTypeId,
              breadSizeId: i.breadSizeId,
              breadAdditionIds: i.breadAdditionIds,
              quantity: i.quantity,
              additionsCharged: i.additionsCharged,
            }));
            setItems(planItems);
            setDealsEnabled(basket.dealsEnabled);
            setAdditionsCharged(basket.additionsCharged);
            setTotalOverride(basket.totalOverride ? String(Number(basket.totalOverride)) : '');
            setIsDelivery(basket.isDelivery);
            setDeliveryManualFee(money(basket.deliveryFee));
            frozen.push({ key: pricingKey(planItems, basket.dealsEnabled, basket.additionsCharged), goods: basket.goods });
          } else {
            setItems(orderItems);
            setDealsEnabled(orderDeals);
            setAdditionsCharged(orderAdditions);
            setTotalOverride(order.totalOverride ? String(Number(order.totalOverride)) : '');
            setIsDelivery(Boolean(order.isDelivery));
            setDeliveryManualFee(money(order.deliveryFee));
          }
          setBaselines(frozen);
          setNotes(plan && plan.notes !== undefined ? plan.notes ?? '' : order.notes || '');
          if (isNext && occ) {
            setDeliveryType((plan?.schedule?.deliveryType ?? order.deliveryType) as DeliveryType);
            // The date box starts on the day the next order would land, so
            // switching to "a specific date" offers next week, not this one.
            setDeliveryDate((plan?.schedule ? occ.date : occ.plainDate) ?? '');
          } else {
            setDeliveryType(order.deliveryType as DeliveryType);
            setDeliveryDate(order.deliveryDate || '');
          }
          setIsRecurring(order.deliveryType !== 'asap' && Boolean(order.isRecurring));
          setLoaded({
            notes: order.notes || '',
            totalOverride: order.totalOverride ? String(Number(order.totalOverride)) : '',
            isDelivery: Boolean(order.isDelivery),
            manualFee: money(order.deliveryFee),
            deliveryType: order.deliveryType as DeliveryType,
            deliveryDate: order.deliveryDate || '',
          });
        } else if (!isEdit) {
          // The same customer, basket, pickup or delivery, notes and price
          // terms as the saved order, as the weekly repeat copies them; not its
          // day (a specific date is picked again), and not the repeat itself.
          const src = o?.order;
          if (src) {
            const copied = copyLinesToMenu(src.items, b.breadTypes);
            // A customer deactivated since is left for the owner to pick: the
            // form knows only listed customers' phones and city, which the
            // WhatsApp checkbox and the delivery fee go by.
            if (c.customers.some((x) => x.id === src.customerId)) setCustomerId(src.customerId);
            copyHold.current = true;
            // Only while delivery is still offered: with it switched off the
            // delivery card is hidden, and nothing could take it back off.
            const delivery = Boolean(src.isDelivery) && Boolean(g?.group?.deliveryEnabled);
            setIsDelivery(delivery);
            setDeliveryManualFee(delivery ? money(src.deliveryFee) : '');
            setDealsEnabled(src.dealsEnabled ?? true);
            setAdditionsCharged(src.additionsCharged ?? true);
            // A custom total priced that basket; with part of it gone it would
            // price something else.
            const customTotal = src.totalOverride != null && Number(src.totalOverride) > 0;
            setTotalOverride(customTotal && !copied.dropped ? String(Number(src.totalOverride)) : '');
            setNotes(src.notes || '');
            setDeliveryType(src.deliveryType as DeliveryType);
            setCopiedFrom({
              id: src.id,
              date: src.deliveryDate ?? null,
              customerId: src.customerId,
              dropped: copied.dropped,
              none: copied.lines.length === 0,
              droppedTotal: customTotal && copied.dropped,
            });
            // Nothing left is left empty, not filled with a bread nobody chose.
            setItems(copied.lines);
          } else if (b.breadTypes.length > 0) {
            const firstType = b.breadTypes[0];
            const defaultSize = firstType.enabledSizes?.[0];
            setItems([{ breadTypeId: firstType.id, breadSizeId: defaultSize?.id ?? null, breadAdditionIds: [], quantity: 1 }]);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Auto-suggest delivery when the selected customer's city changes (create mode).
  useEffect(() => {
    if (isEdit || !delivSettings) return;
    if (copyHold.current) {
      // "שנה" alone clears the customer to open the list; only picking
      // someone else lets go of the copy.
      if (customerId == null || customerId === copiedFrom?.customerId) return;
      // Another customer: the suggestion is theirs, and so is any manual fee.
      copyHold.current = false;
      setDeliveryManualFee('');
    }
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

  const [creatingCustomer, setCreatingCustomer] = useState(false);

  async function handleCreateCustomer() {
    // Guarded and caught. A failed POST rejected into nothing at all — no
    // toast, no line in front of the owner — and a second tap during a slow
    // one created the customer twice, splitting that person's history and
    // temperature score between two rows nothing merges.
    if (!newCustomerName.trim() || creatingCustomer) return;
    setCreatingCustomer(true);
    try {
      const { customer } = await apiFetch<{ customer: Customer }>('/customers', {
        method: 'POST',
        body: JSON.stringify({ name: newCustomerName.trim() }),
      });
      setCustomers((prev) => [...prev, customer]);
      setCustomerId(customer.id);
      setShowNewCustomer(false);
      setNewCustomerName('');
    } catch (e) {
      toast.error(friendlyError(e, t('customers.save_failed')));
    } finally {
      setCreatingCustomer(false);
    }
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

  /**
   * The parts of a waiting next-occurrence change this plain edit also touches.
   * Only those need asking about: an edit to anything else carries forward on
   * its own, as edits always have.
   */
  /** Whether this plain edit moves this week's order to another day. */
  function movesThisWeek(): boolean {
    if (!loaded) return false;
    return (
      deliveryType !== loaded.deliveryType ||
      (deliveryType === 'specific_date' && deliveryDate !== loaded.deliveryDate)
    );
  }

  function conflictingSections(): NextChangeSection[] {
    const waiting = nextOcc?.change?.sections ?? [];
    const stillRepeats = deliveryType !== 'asap' && isRecurring;
    if (waiting.length === 0 || !loaded || !stillRepeats) return [];
    const changed: NextChangeSection[] = [];
    if (
      repriced ||
      totalOverride !== loaded.totalOverride ||
      isDelivery !== loaded.isDelivery ||
      deliveryManualFee !== loaded.manualFee
    ) {
      changed.push('basket');
    }
    if (notes !== loaded.notes) changed.push('notes');
    if (movesThisWeek()) changed.push('schedule');
    return changed.filter((s) => waiting.includes(s));
  }

  function handleSubmit() {
    if (!customerId || items.length === 0) return;
    if (isNext) {
      void saveNextChange();
      return;
    }
    if (isEdit) {
      const conflicts = conflictingSections();
      if (conflicts.length > 0) {
        setConflict(conflicts);
        return;
      }
    }
    void saveOrder();
  }

  async function saveNextChange() {
    setSubmitting(true);
    try {
      const { nextOccurrence } = await apiFetch<{ nextOccurrence: NextOccurrenceView | null }>(
        `/orders/${editId}/next-change`,
        {
          method: 'PUT',
          body: JSON.stringify({
            deliveryType,
            deliveryDate: deliveryType === 'specific_date' ? deliveryDate : undefined,
            items,
            notes,
            totalOverride: totalOverride || null,
            isDelivery,
            deliveryFee: effectiveFee.toFixed(2),
            dealsEnabled,
            additionsCharged,
          }),
        }
      );
      if (nextOccurrence?.change && nextOccurrence.date) {
        toast.success(t('orders.next_change_saved').replace('{date}', formatWeekdayShort(nextOccurrence.date)));
      } else {
        toast.success(t('orders.next_change_none'));
      }
      router.push(`/miniapp/orders/${editId}`);
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        toast.error(t('orders.next_change_too_late'));
        router.replace(`/miniapp/orders/${editId}`);
      } else {
        toast.error(friendlyError(e, t('orders.update_failed')));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function saveOrder(dropNextChange?: NextChangeSection[]) {
    setConflict(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        await apiFetch(`/orders/${editId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            deliveryType,
            deliveryDate: deliveryType === 'specific_date' ? deliveryDate : undefined,
            items,
            // Sent even when empty. `|| undefined` drops the key from the JSON
            // and the route's "did they send notes?" guard never runs, so
            // deleting a note saved nothing, said "ההזמנה עודכנה", and left the
            // old text on the print sheet and in every recurring clone.
            notes,
            totalOverride: totalOverride || null,
            isDelivery,
            deliveryFee: effectiveFee.toFixed(2),
            isRecurring: deliveryType === 'asap' ? false : isRecurring,
            dealsEnabled,
            additionsCharged,
            ...(dropNextChange?.length ? { dropNextChange } : {}),
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
            isRecurring: deliveryType === 'asap' ? false : isRecurring,
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
        <PageHeader title={isEdit ? (isNext ? t('orders.next_change_title').replace('{date}', '…') : t('orders.edit')) : t('orders.new_order')} />
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
      chargeAdditions: item.additionsCharged ?? additionsCharged, // per-line override else order default
      tierPrices: size.tiers ?? {},
    })),
    tierQtysBySize,
    surcharge: additionsSurcharge,
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
  // A non-item edit keeps the frozen snapshot server-side, so the fee must be
  // judged on the same figure: a catalog price rise crossing the free-delivery
  // threshold in the meantime would otherwise zero a fee this order's own goods
  // never earned. Touch the items and the order re-prices, so live is right.
  // The flags count too: the route re-prices when dealsEnabled or
  // additionsCharged move, even if no line was touched, so pricing the fee on
  // the pre-toggle figure would bill a fee the re-priced order does not carry.
  const currentKey = pricingKey(items, dealsEnabled, additionsCharged);
  const frozenBaseline = baselines.find((b) => b.key === currentKey);
  const repriced = frozenBaseline == null;
  const goodsForThisOrder = frozenBaseline ? frozenBaseline.goods : liveTotal;
  const computedFee = delivSettings
    ? resolveDeliveryFee({
        city: custCity,
        subtotal: goodsForThisOrder,
        settings: delivSettings,
        manualFee: Number(deliveryManualFee || 0),
      })
    : Number(deliveryManualFee || 0);
  const effectiveFee = isDelivery ? computedFee : 0;

  // Earliest selectable delivery date (today, local time) as yyyy-MM-dd
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  // A next occurrence always has a day: no "בהקדם" there.
  const deliveryOptions = ([
    ['shabbat', t('delivery.shabbat')],
    ['asap', t('delivery.asap')],
    ['specific_date', t('delivery.specific_date')],
    ['weekly', t('delivery.weekly')],
  ] as [DeliveryType, string][]).filter(([type]) => !isNext || type !== 'asap');

  // Next mode: the day the change starts, by the server's rules. The next
  // occurrence keeps its week — שבת/שבועי land on that week's Friday, a
  // specific date is the one picked, and a Friday already planned stays put.
  const plannedFriday =
    nextOcc?.change?.schedule && isFridayType(nextOcc.change.schedule.deliveryType) ? nextOcc.date : null;
  const nextDate =
    isNext && nextOcc
      ? deliveryType === 'specific_date'
        ? deliveryDate || null
        : plannedFriday ??
          (nextOcc.plainDate ? rollWeeklyPast(fridayOfWeek(nextOcc.plainDate), nextOcc.floor) : null)
      : null;
  const minDate = isNext && nextOcc ? dayAfter(nextOcc.floor) : todayIso;
  const waiting = !isNext ? nextOcc?.change ?? null : null;

  return (
    <>
      <PageHeader
        title={
          isNext
            ? t('orders.next_change_title').replace('{date}', nextDate ? formatDayMonth(nextDate) : '…')
            : isEdit
              ? t('orders.edit')
              : t('orders.new_order')
        }
      />
      <div className="p-5 space-y-4 animate-fade-in">
        {/* Next mode says up front which order this is not touching. */}
        {isNext && orderDate && (
          <Card className="border-primary/30 bg-primary/5">
            <div className="flex items-start gap-2.5">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm">
                {t('orders.next_change_keeps')
                  .replace('{date}', formatWeekdayShort(orderDate))
                  .replace('{next}', nextDate ? formatWeekdayShort(nextDate) : '…')}
              </p>
            </div>
          </Card>
        )}
        {/* A plain edit while a change waits: say so, since this edit then
            reaches this week only for the parts the change holds. */}
        {waiting && nextOcc?.date && (
          <Card className="border-primary/30 bg-primary/5">
            <div className="flex items-start gap-2.5">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm">
                {t('orders.next_change_pending')
                  .replace('{date}', formatWeekdayShort(nextOcc.date))
                  .replace('{sections}', sectionsLabel(t, waiting.sections))}
              </p>
            </div>
          </Card>
        )}

        {copiedFrom && (
          <Card className="border-primary/30 bg-primary/5">
            <div className="flex items-start gap-2.5">
              <CopyPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-1 text-sm">
                <p>
                  {(copiedFrom.date ? t('orders.copied_from') : t('orders.copied_from_nodate'))
                    .replace('{id}', String(copiedFrom.id))
                    .replace('{date}', copiedFrom.date ? formatWeekdayShort(copiedFrom.date) : '')}
                </p>
                {copiedFrom.dropped && (
                  <p className="flex items-start gap-1.5 text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t(
                      copiedFrom.none
                        ? 'orders.copied_none'
                        : copiedFrom.droppedTotal
                          ? 'orders.copied_dropped_total'
                          : 'orders.copied_dropped'
                    )}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

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
                  <Button
                    size="sm"
                    loading={creatingCustomer}
                    disabled={!newCustomerName.trim()}
                    onClick={handleCreateCustomer}
                  >
                    {t('form.add')}
                  </Button>
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
                          <button
                            type="button"
                            onClick={() => updateItem(idx, { additionsCharged: !(item.additionsCharged ?? additionsCharged) })}
                            title={t('order.charge_additions')}
                            className={cn(
                              '-my-0.5 rounded border px-1.5 py-0.5 tabular-nums transition-colors',
                              (item.additionsCharged ?? additionsCharged)
                                ? 'border-primary/30 bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground/60 line-through'
                            )}
                          >
                            +₪{additionsSurcharge}
                          </button>
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
                  onClick={() => {
                    setDeliveryType(type);
                    // "Repeat weekly" is hidden for asap; clear it so a stale flag
                    // can't ride along on a now-asap order.
                    if (type === 'asap') setIsRecurring(false);
                  }}
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
              min={minDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="mt-3"
            />
          )}
          {isNext && nextDate && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {t('orders.next_change_starts').replace('{date}', formatWeekdayShort(nextDate))}
            </p>
          )}
          {!isNext && deliveryType !== 'asap' && (
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

        {/* Notify customer (only on create, only if customer has a number on WhatsApp) */}
        {!isEdit && selectedCustomer && ((selectedCustomer as Customer).phones ?? []).some((p) => p.hasWhatsapp !== false) && (
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
              {/* Only when the order will actually be re-priced: on a
                  notes-or-date edit the server keeps the frozen snapshot, so
                  these rows would describe a re-bundle that never happens —
                  under a total that is not this order's total. */}
              {hasDeal && !totalOverride && repriced &&
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
                  ₪{(totalOverride ? Number(totalOverride) : goodsForThisOrder) + effectiveFee}
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
              (deliveryType === 'specific_date' && !deliveryDate) ||
              (isNext && deliveryType === 'specific_date' && deliveryDate < minDate)
            }
            loading={submitting}
            onClick={handleSubmit}
          >
            {isNext
              ? t('orders.next_change_save').replace('{date}', nextDate ? formatDayMonth(nextDate) : '…')
              : isEdit
                ? t('form.update_order')
                : t('form.create_order')}
          </Button>
        </div>
      </div>
      {conflict && (
        <NextChangeConflictSheet
          // Moving this week's date moves the next one too, so the date known
          // at load would be wrong in the labels; they say "the next orders".
          date={nextOcc?.date && !movesThisWeek() ? formatDayMonth(nextOcc.date) : null}
          sections={conflict}
          onPick={(follow) => void saveOrder(follow ? conflict : undefined)}
          onClose={() => setConflict(null)}
        />
      )}
    </>
  );
}
