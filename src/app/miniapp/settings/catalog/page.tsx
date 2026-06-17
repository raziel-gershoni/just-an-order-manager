'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ControlCenterTabs } from '@/components/ui/ControlCenterTabs';
import { cn } from '@/lib/utils';
import {
  Pencil, Plus, Pause, Play, Trash2, ChevronUp, ChevronDown, ChevronRight, ChevronLeft,
  Star,
} from 'lucide-react';
import { RecipeEditor } from '@/components/RecipeEditor';

interface BreadSize {
  id: number;
  name: string;
  weightGrams: number | null;
  price: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface EnabledSize {
  id: number;
  name: string;
  weightGrams: number | null;
  price: string;
  priceOverride: string | null;
  isActive: boolean;
}

interface EnabledAddition { id: number; name: string; isActive: boolean }

interface BreadType {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  enabledSizes: EnabledSize[];
  enabledAdditions: EnabledAddition[];
}

interface TypeDetailSize {
  id: number;
  name: string;
  weightGrams: number | null;
  price: string;
  isDefault: boolean;
  enabled: boolean;
  priceOverride: string | null;
}

interface TypeDetailAddition {
  id: number;
  name: string;
  isDefault: boolean;
  enabled: boolean;
}

interface BreadAddition {
  id: number;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export default function CatalogPage() {
  const { apiFetch } = useApi();
  const { activeGroupId, activeGroupRole } = useGroup();
  const t = useT();
  const toast = useToast();
  const isBaker = activeGroupRole === 'baker';

  // Top-level section collapse state — bread types open by default,
  // catalogs collapsed (managers expand them when curating).
  const [sizesSectionOpen, setSizesSectionOpen] = useState(false);
  const [additionsSectionOpen, setAdditionsSectionOpen] = useState(false);
  const [breadTypesSectionOpen, setBreadTypesSectionOpen] = useState(true);

  const [sizes, setSizes] = useState<BreadSize[]>([]);
  const [additions, setAdditions] = useState<BreadAddition[]>([]);
  const [breadTypes, setBreadTypes] = useState<BreadType[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- Sizes catalog state ----
  const [editingSizeId, setEditingSizeId] = useState<number | null>(null);
  const [editSizeName, setEditSizeName] = useState('');
  const [editSizeWeight, setEditSizeWeight] = useState('');
  const [editSizePrice, setEditSizePrice] = useState('');
  const [showAddSize, setShowAddSize] = useState(false);
  const [newSizeName, setNewSizeName] = useState('');
  const [newSizeWeight, setNewSizeWeight] = useState('');
  const [newSizePrice, setNewSizePrice] = useState('');
  const [newSizeDefault, setNewSizeDefault] = useState(false);
  const [savingSizeOrder, setSavingSizeOrder] = useState(false);

  // ---- Additions catalog state ----
  const [editingAdditionId, setEditingAdditionId] = useState<number | null>(null);
  const [editAdditionName, setEditAdditionName] = useState('');
  const [showAddAddition, setShowAddAddition] = useState(false);
  const [newAdditionName, setNewAdditionName] = useState('');
  const [newAdditionDefault, setNewAdditionDefault] = useState(false);
  const [savingAdditionOrder, setSavingAdditionOrder] = useState(false);
  const [additionsSurcharge, setAdditionsSurcharge] = useState('');
  const [savingSurcharge, setSavingSurcharge] = useState(false);

  // ---- Bread types state ----
  const [expandedTypeId, setExpandedTypeId] = useState<number | null>(null);
  const [typeDetailSizes, setTypeDetailSizes] = useState<TypeDetailSize[]>([]);
  const [typeDetailAdditions, setTypeDetailAdditions] = useState<TypeDetailAddition[]>([]);
  const [typeNameDraft, setTypeNameDraft] = useState('');
  const [savingType, setSavingType] = useState(false);
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [addingType, setAddingType] = useState(false);

  useEffect(() => {
    if (!activeGroupId) return;
    Promise.all([
      apiFetch<{ breadTypes: BreadType[] }>(`/groups/${activeGroupId}/bread-types`),
      apiFetch<{ sizes: BreadSize[] }>(`/groups/${activeGroupId}/bread-sizes`),
      apiFetch<{ additions: BreadAddition[] }>(`/groups/${activeGroupId}/bread-additions`),
      apiFetch<{ group: { additionsSurcharge: string } }>(`/groups/${activeGroupId}`),
    ])
      .then(([typesResp, sizesResp, additionsResp, groupResp]) => {
        setBreadTypes(typesResp.breadTypes);
        setSizes(sizesResp.sizes);
        setAdditions(additionsResp.additions);
        setAdditionsSurcharge(String(Number(groupResp.group.additionsSurcharge ?? 0)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId]);

  async function saveAdditionsSurcharge(value: string) {
    if (!activeGroupId) return;
    const v = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(v)) {
      toast.error(t('settings.delete_failed'));
      return;
    }
    setSavingSurcharge(true);
    try {
      await apiFetch(`/groups/${activeGroupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ additionsSurcharge: v }),
      });
      setAdditionsSurcharge(String(Number(v)));
      toast.success(t('settings.additions_surcharge_saved'));
    } catch {
      toast.error(t('settings.delete_failed'));
    } finally {
      setSavingSurcharge(false);
    }
  }

  // ============ SIZES CATALOG ============

  async function addSize() {
    if (!newSizeName.trim() || !newSizePrice || !activeGroupId) return;
    const { size } = await apiFetch<{ size: BreadSize }>(
      `/groups/${activeGroupId}/bread-sizes`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: newSizeName.trim(),
          weightGrams: newSizeWeight ? Number(newSizeWeight) : null,
          price: newSizePrice,
          isDefault: newSizeDefault,
        }),
      }
    );
    setSizes((prev) => [...prev, size]);
    setNewSizeName('');
    setNewSizeWeight('');
    setNewSizePrice('');
    setNewSizeDefault(false);
    setShowAddSize(false);
  }

  async function saveSize(id: number) {
    if (!editSizeName.trim() || !editSizePrice) return;
    const { size } = await apiFetch<{ size: BreadSize }>(`/bread-sizes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: editSizeName.trim(),
        weightGrams: editSizeWeight ? Number(editSizeWeight) : null,
        price: editSizePrice,
      }),
    });
    setSizes((prev) => prev.map((s) => (s.id === id ? { ...s, ...size } : s)));
    setEditingSizeId(null);
  }

  async function toggleDefault(id: number, current: boolean) {
    const { size } = await apiFetch<{ size: BreadSize }>(`/bread-sizes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isDefault: !current }),
    });
    setSizes((prev) => prev.map((s) => (s.id === id ? { ...s, ...size } : s)));
  }

  async function toggleActive(id: number, isActive: boolean) {
    const { size } = await apiFetch<{ size: BreadSize }>(`/bread-sizes/${id}`, {
      method: isActive ? 'DELETE' : 'PATCH',
      ...(!isActive && { body: JSON.stringify({ isActive: true }) }),
    });
    setSizes((prev) => prev.map((s) => (s.id === id ? { ...s, ...size } : s)));
  }

  async function deleteSize(id: number) {
    try {
      await apiFetch(`/bread-sizes/${id}?hard=true`, { method: 'DELETE' });
      setSizes((prev) => prev.filter((s) => s.id !== id));
      setEditingSizeId(null);
    } catch {
      toast.error(t('settings.delete_failed'));
    }
  }

  async function moveSize(id: number, dir: 'up' | 'down') {
    const idx = sizes.findIndex((s) => s.id === id);
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= sizes.length) return;
    const next = [...sizes];
    [next[idx], next[target]] = [next[target], next[idx]];
    setSizes(next);
    setSavingSizeOrder(true);
    try {
      await apiFetch(`/groups/${activeGroupId}/bread-sizes/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: next.map((s) => s.id) }),
      });
    } catch {
      toast.error(t('settings.reorder_failed'));
    } finally {
      setSavingSizeOrder(false);
    }
  }

  // ============ ADDITIONS CATALOG ============

  async function addAddition() {
    if (!newAdditionName.trim() || !activeGroupId) return;
    const { addition } = await apiFetch<{ addition: BreadAddition }>(
      `/groups/${activeGroupId}/bread-additions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: newAdditionName.trim(),
          isDefault: newAdditionDefault,
        }),
      }
    );
    setAdditions((prev) => [...prev, addition]);
    setNewAdditionName('');
    setNewAdditionDefault(false);
    setShowAddAddition(false);
  }

  async function saveAddition(id: number) {
    if (!editAdditionName.trim()) return;
    const { addition } = await apiFetch<{ addition: BreadAddition }>(`/bread-additions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editAdditionName.trim() }),
    });
    setAdditions((prev) => prev.map((a) => (a.id === id ? { ...a, ...addition } : a)));
    setEditingAdditionId(null);
  }

  async function toggleAdditionDefault(id: number, current: boolean) {
    const { addition } = await apiFetch<{ addition: BreadAddition }>(`/bread-additions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isDefault: !current }),
    });
    setAdditions((prev) => prev.map((a) => (a.id === id ? { ...a, ...addition } : a)));
  }

  async function toggleAdditionActive(id: number, isActive: boolean) {
    const { addition } = await apiFetch<{ addition: BreadAddition }>(`/bread-additions/${id}`, {
      method: isActive ? 'DELETE' : 'PATCH',
      ...(!isActive && { body: JSON.stringify({ isActive: true }) }),
    });
    setAdditions((prev) => prev.map((a) => (a.id === id ? { ...a, ...addition } : a)));
  }

  async function deleteAddition(id: number) {
    try {
      await apiFetch(`/bread-additions/${id}?hard=true`, { method: 'DELETE' });
      setAdditions((prev) => prev.filter((a) => a.id !== id));
      setEditingAdditionId(null);
    } catch {
      toast.error(t('settings.delete_failed'));
    }
  }

  async function moveAddition(id: number, dir: 'up' | 'down') {
    const idx = additions.findIndex((a) => a.id === id);
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= additions.length) return;
    const next = [...additions];
    [next[idx], next[target]] = [next[target], next[idx]];
    setAdditions(next);
    setSavingAdditionOrder(true);
    try {
      await apiFetch(`/groups/${activeGroupId}/bread-additions/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: next.map((a) => a.id) }),
      });
    } catch {
      toast.error(t('settings.reorder_failed'));
    } finally {
      setSavingAdditionOrder(false);
    }
  }

  // ============ BREAD TYPES ============

  async function expandType(typeId: number) {
    if (expandedTypeId === typeId) {
      setExpandedTypeId(null);
      return;
    }
    setExpandedTypeId(typeId);
    const type = breadTypes.find((t) => t.id === typeId);
    if (type) setTypeNameDraft(type.name);

    const { breadType } = await apiFetch<{ breadType: { sizes: TypeDetailSize[]; additions: TypeDetailAddition[] } }>(
      `/groups/${activeGroupId}/bread-types/${typeId}`
    );
    setTypeDetailSizes(breadType.sizes);
    setTypeDetailAdditions(breadType.additions);
  }

  function toggleAdditionEnabledForType(additionId: number) {
    setTypeDetailAdditions((prev) =>
      prev.map((a) => (a.id === additionId ? { ...a, enabled: !a.enabled } : a))
    );
  }

  function toggleEnabled(sizeId: number) {
    setTypeDetailSizes((prev) =>
      prev.map((s) =>
        s.id === sizeId
          ? { ...s, enabled: !s.enabled, priceOverride: s.enabled ? null : s.priceOverride }
          : s
      )
    );
  }

  function updateOverride(sizeId: number, value: string) {
    setTypeDetailSizes((prev) =>
      prev.map((s) => (s.id === sizeId ? { ...s, priceOverride: value || null } : s))
    );
  }

  async function saveType(typeId: number) {
    setSavingType(true);
    try {
      // Save name if changed
      const original = breadTypes.find((t) => t.id === typeId);
      if (original && typeNameDraft.trim() && typeNameDraft.trim() !== original.name) {
        const { breadType } = await apiFetch<{ breadType: BreadType }>(
          `/bread-types/${typeId}`,
          { method: 'PATCH', body: JSON.stringify({ name: typeNameDraft.trim() }) }
        );
        setBreadTypes((prev) =>
          prev.map((t) => (t.id === typeId ? { ...t, name: breadType.name } : t))
        );
      }

      // Save enabled sizes
      const enabledSizes = typeDetailSizes
        .filter((s) => s.enabled)
        .map((s) => ({
          breadSizeId: s.id,
          priceOverride: s.priceOverride && s.priceOverride !== s.price ? s.priceOverride : null,
        }));
      await apiFetch(`/groups/${activeGroupId}/bread-types/${typeId}/sizes`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: enabledSizes }),
      });

      // Save enabled additions
      const enabledAdditions = typeDetailAdditions.filter((a) => a.enabled).map((a) => a.id);
      await apiFetch(`/groups/${activeGroupId}/bread-types/${typeId}/additions`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: enabledAdditions }),
      });

      // Update local breadTypes for count display
      setBreadTypes((prev) =>
        prev.map((t) =>
          t.id === typeId
            ? {
                ...t,
                enabledSizes: typeDetailSizes
                  .filter((s) => s.enabled)
                  .map((s) => ({
                    id: s.id,
                    name: s.name,
                    weightGrams: s.weightGrams,
                    price: s.price,
                    priceOverride: s.priceOverride,
                    isActive: true,
                  })),
                enabledAdditions: typeDetailAdditions
                  .filter((a) => a.enabled)
                  .map((a) => ({ id: a.id, name: a.name, isActive: true })),
              }
            : t
        )
      );
      toast.success(t('settings.deleted').replace('!נמחק', '✓').replace('Deleted!', '✓'));
    } catch {
      toast.error(t('customers.save_failed'));
    } finally {
      setSavingType(false);
    }
  }

  async function deleteType(typeId: number) {
    try {
      await apiFetch(`/bread-types/${typeId}?hard=true`, { method: 'DELETE' });
      setBreadTypes((prev) => prev.filter((t) => t.id !== typeId));
      setExpandedTypeId(null);
    } catch {
      toast.error(t('settings.delete_failed'));
    }
  }

  async function addType() {
    if (!newTypeName.trim() || !activeGroupId) return;
    setAddingType(true);
    try {
      const { breadType } = await apiFetch<{ breadType: BreadType }>(
        `/groups/${activeGroupId}/bread-types`,
        { method: 'POST', body: JSON.stringify({ name: newTypeName.trim() }) }
      );
      setBreadTypes((prev) => [...prev, breadType]);
      setExpandedTypeId(breadType.id);
      // Pre-load detail (it has the auto-enabled defaults)
      const { breadType: detail } = await apiFetch<{ breadType: { sizes: TypeDetailSize[]; additions: TypeDetailAddition[] } }>(
        `/groups/${activeGroupId}/bread-types/${breadType.id}`
      );
      setTypeDetailSizes(detail.sizes);
      setTypeDetailAdditions(detail.additions);
      setTypeNameDraft(breadType.name);
      setNewTypeName('');
      setShowAddType(false);
    } catch {
      toast.error(t('customers.save_failed'));
    } finally {
      setAddingType(false);
    }
  }

  async function toggleTypeActive(id: number, isActive: boolean) {
    try {
      await apiFetch(`/bread-types/${id}`, {
        method: isActive ? 'DELETE' : 'PATCH',
        ...(!isActive && { body: JSON.stringify({ isActive: true }) }),
      });
      setBreadTypes((prev) => prev.map((bt) => (bt.id === id ? { ...bt, isActive: !isActive } : bt)));
    } catch {
      toast.error(t('settings.delete_failed'));
    }
  }

  if (loading) {
    return (
      <>
        <ControlCenterTabs />
        <div className="p-5 space-y-4">
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
          <div className="h-48 rounded-xl bg-muted animate-pulse" />
        </div>
      </>
    );
  }

  const editingType = breadTypes.find((bt) => bt.id === expandedTypeId) ?? null;

  return (
    <>
      <ControlCenterTabs />
      <div className="p-5 space-y-4 animate-fade-in">
        {/* SIZES CATALOG (managers only) */}
        {!isBaker && (
        <section>
          <button
            type="button"
            onClick={() => setSizesSectionOpen((v) => !v)}
            className="w-full flex items-center justify-between mb-2 group"
          >
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  sizesSectionOpen && 'rotate-90'
                )}
              />
              {t('settings.global_sizes')}
              <span className="text-xs font-normal normal-case opacity-60 tabular-nums">
                · {sizes.length}
              </span>
            </h2>
          </button>

          {sizesSectionOpen && (<>
          <div className="space-y-2">
            {sizes.length === 0 && (
              <Card className="text-sm text-muted-foreground italic text-center py-6">
                —
              </Card>
            )}
            {sizes.map((s, idx) =>
              editingSizeId === s.id ? (
                <Card key={s.id} className="animate-expand p-3 space-y-3">
                  <Input
                    label={t('settings.size_name')}
                    value={editSizeName}
                    onChange={(e) => setEditSizeName(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      label={t('settings.weight')}
                      type="number"
                      inputMode="numeric"
                      value={editSizeWeight}
                      onChange={(e) => setEditSizeWeight(e.target.value)}
                    />
                    <Input
                      label={t('settings.price')}
                      type="number"
                      inputMode="decimal"
                      value={editSizePrice}
                      onChange={(e) => setEditSizePrice(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 items-center pt-1">
                    <Button size="sm" className="flex-1" onClick={() => saveSize(s.id)}>{t('settings.save')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingSizeId(null)}>{t('payments.cancel')}</Button>
                    <Button size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10 h-8 w-8" onClick={() => deleteSize(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ) : (
                <Card key={s.id} className="flex justify-between items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex flex-col -my-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={savingSizeOrder || idx === 0}
                        onClick={() => moveSize(s.id, 'up')}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={savingSizeOrder || idx === sizes.length - 1}
                        onClick={() => moveSize(s.id, 'down')}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <span className={cn('font-medium', !s.isActive && 'text-muted-foreground line-through')}>
                      {s.name}
                    </span>
                    {s.weightGrams != null && (
                      <span className="text-xs text-muted-foreground tabular-nums">{s.weightGrams}g</span>
                    )}
                    <span className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full tabular-nums',
                      s.isActive ? 'bg-muted text-muted-foreground' : 'bg-muted/50 text-muted-foreground/50'
                    )}>
                      ₪{s.price}
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggleDefault(s.id, s.isDefault)}
                      aria-label={t('settings.is_default')}
                      title={t('settings.is_default_hint')}
                    >
                      <Star
                        className={cn(
                          'h-3.5 w-3.5',
                          s.isDefault ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40'
                        )}
                      />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditingSizeId(s.id);
                      setEditSizeName(s.name);
                      setEditSizeWeight(s.weightGrams != null ? String(s.weightGrams) : '');
                      setEditSizePrice(s.price);
                    }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => toggleActive(s.id, s.isActive)}>
                      {s.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </Card>
              )
            )}
          </div>

          {showAddSize ? (
            <Card className="mt-3 p-3 space-y-3 animate-expand">
              <Input
                label={t('settings.size_name')}
                value={newSizeName}
                onChange={(e) => setNewSizeName(e.target.value)}
                placeholder="כיכר"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label={t('settings.weight')}
                  type="number"
                  inputMode="numeric"
                  value={newSizeWeight}
                  onChange={(e) => setNewSizeWeight(e.target.value)}
                  placeholder="900"
                />
                <Input
                  label={t('settings.price')}
                  type="number"
                  inputMode="decimal"
                  value={newSizePrice}
                  onChange={(e) => setNewSizePrice(e.target.value)}
                  placeholder="20"
                />
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-muted/50 transition-colors -my-1">
                <input
                  type="checkbox"
                  checked={newSizeDefault}
                  onChange={(e) => setNewSizeDefault(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Star className="h-3.5 w-3.5" />
                    {t('settings.is_default')}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t('settings.is_default_hint')}
                  </div>
                </div>
              </label>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={addSize}>{t('form.add')}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowAddSize(false); setNewSizeName(''); setNewSizeWeight(''); setNewSizePrice(''); setNewSizeDefault(false); }}>
                  {t('payments.cancel')}
                </Button>
              </div>
            </Card>
          ) : (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAddSize(true)}>
              <Plus className="h-4 w-4" />
              {t('settings.add_global_size')}
            </Button>
          )}
          </>)}
        </section>
        )}

        {/* ADDITIONS CATALOG (managers only) */}
        {!isBaker && (
        <section>
          <button
            type="button"
            onClick={() => setAdditionsSectionOpen((v) => !v)}
            className="w-full flex items-center justify-between mb-2 group"
          >
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  additionsSectionOpen && 'rotate-90'
                )}
              />
              {t('settings.additions')}
              <span className="text-xs font-normal normal-case opacity-60 tabular-nums">
                · {additions.length}
              </span>
            </h2>
          </button>

          {additionsSectionOpen && (<>
          <Card className="mb-3 p-3 space-y-2">
            <label className="text-sm font-medium">
              {t('settings.additions_surcharge')}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm shrink-0">₪</span>
              <Input
                type="number"
                inputMode="decimal"
                value={additionsSurcharge}
                onChange={(e) => setAdditionsSurcharge(e.target.value)}
                placeholder="0"
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={() => saveAdditionsSurcharge(additionsSurcharge)}
                loading={savingSurcharge}
              >
                {t('settings.save')}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {t('settings.additions_surcharge_hint')}
            </div>
          </Card>
          <div className="space-y-2">
            {additions.length === 0 && (
              <Card className="text-sm text-muted-foreground italic text-center py-6">—</Card>
            )}
            {additions.map((a, idx) =>
              editingAdditionId === a.id ? (
                <Card key={a.id} className="animate-expand p-3 space-y-3">
                  <Input
                    label={t('settings.name')}
                    value={editAdditionName}
                    onChange={(e) => setEditAdditionName(e.target.value)}
                  />
                  <div className="flex gap-2 items-center pt-1">
                    <Button size="sm" className="flex-1" onClick={() => saveAddition(a.id)}>{t('settings.save')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingAdditionId(null)}>{t('payments.cancel')}</Button>
                    <Button size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10 h-8 w-8" onClick={() => deleteAddition(a.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ) : (
                <Card key={a.id} className="flex justify-between items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex flex-col -my-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={savingAdditionOrder || idx === 0}
                        onClick={() => moveAddition(a.id, 'up')}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={savingAdditionOrder || idx === additions.length - 1}
                        onClick={() => moveAddition(a.id, 'down')}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <span className={cn('font-medium', !a.isActive && 'text-muted-foreground line-through')}>
                      {a.name}
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggleAdditionDefault(a.id, a.isDefault)}
                      aria-label={t('settings.is_default')}
                      title={t('settings.is_default_hint')}
                    >
                      <Star
                        className={cn(
                          'h-3.5 w-3.5',
                          a.isDefault ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40'
                        )}
                      />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditingAdditionId(a.id);
                      setEditAdditionName(a.name);
                    }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => toggleAdditionActive(a.id, a.isActive)}>
                      {a.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </Card>
              )
            )}
          </div>

          {showAddAddition ? (
            <Card className="mt-3 p-3 space-y-3 animate-expand">
              <Input
                label={t('settings.name')}
                value={newAdditionName}
                onChange={(e) => setNewAdditionName(e.target.value)}
                placeholder="פשטן"
              />
              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-muted/50 transition-colors -my-1">
                <input
                  type="checkbox"
                  checked={newAdditionDefault}
                  onChange={(e) => setNewAdditionDefault(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Star className="h-3.5 w-3.5" />
                    {t('settings.is_default')}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t('settings.is_default_hint')}
                  </div>
                </div>
              </label>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={addAddition}>{t('form.add')}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowAddAddition(false); setNewAdditionName(''); setNewAdditionDefault(false); }}>
                  {t('payments.cancel')}
                </Button>
              </div>
            </Card>
          ) : (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAddAddition(true)}>
              <Plus className="h-4 w-4" />
              {t('settings.add_addition')}
            </Button>
          )}
          </>)}
        </section>
        )}

        {/* BREAD TYPES */}
        <section>
          <button
            type="button"
            onClick={() => setBreadTypesSectionOpen((v) => !v)}
            className="w-full flex items-center justify-between mb-2 group"
          >
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  breadTypesSectionOpen && 'rotate-90'
                )}
              />
              {t('settings.bread_types')}
              <span className="text-xs font-normal normal-case opacity-60 tabular-nums">
                · {breadTypes.length}
              </span>
            </h2>
          </button>

          {breadTypesSectionOpen && (<>
          <Card className="p-0 overflow-hidden">
            {breadTypes.map((bt, idx) => {
              const priced = bt.enabledSizes
                .map((s) => Number(s.priceOverride ?? s.price))
                .filter((n) => !Number.isNaN(n));
              const low = priced.length ? Math.min(...priced) : null;
              const high = priced.length ? Math.max(...priced) : null;
              return (
                <div
                  key={bt.id}
                  className={cn(
                    'flex items-center gap-2.5 px-3.5 py-3',
                    idx > 0 && 'border-t border-dashed border-border'
                  )}
                >
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    #{String(idx + 1).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    className="flex items-center gap-2 flex-1 text-start min-w-0"
                    onClick={() => expandType(bt.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className={cn('font-medium truncate', !bt.isActive && 'text-muted-foreground line-through')}>
                        {bt.name}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {bt.enabledSizes.length} גדלים
                        {low != null && high != null && (
                          low === high ? ` · ₪${low}` : ` · ₪${low}–${high}`
                        )}
                      </div>
                    </div>
                    <ChevronLeft className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  </button>
                  {!isBaker && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => toggleTypeActive(bt.id, bt.isActive)}
                      aria-label={bt.isActive ? t('settings.disable') : t('settings.enable')}
                      title={bt.isActive ? t('settings.disable') : t('settings.enable')}
                    >
                      {bt.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              );
            })}
          </Card>

          {!isBaker && (
            showAddType ? (
              <Card className="mt-3 p-3 space-y-3 animate-expand">
                <Input
                  label={t('settings.name')}
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  placeholder="חיטה לבן"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" loading={addingType} disabled={!newTypeName.trim()} onClick={addType}>
                    {t('form.add')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowAddType(false); setNewTypeName(''); }}>
                    {t('payments.cancel')}
                  </Button>
                </div>
              </Card>
            ) : (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAddType(true)}>
                <Plus className="h-4 w-4" />
                {t('settings.add_bread')}
              </Button>
            )
          )}
          </>)}
        </section>
      </div>

      {/* FULL-SCREEN bread editor */}
      {editingType && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto pb-24 animate-fade-in">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card/50 backdrop-blur-sm px-2 py-2">
            <button
              type="button"
              aria-label="חזרה"
              className="flex h-11 w-11 items-center justify-center shrink-0"
              onClick={() => setExpandedTypeId(null)}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-bold truncate">{editingType.name}</h1>
          </div>

          <div className="p-5 space-y-3">
            {/* Name (managers edit, bakers see read-only) */}
            {isBaker ? (
              <div className="text-base font-semibold">{editingType.name}</div>
            ) : (
              <Input
                label={t('settings.name')}
                value={typeNameDraft}
                onChange={(e) => setTypeNameDraft(e.target.value)}
              />
            )}

            {/* Recipe — surfaced near the top (primary use case) */}
            <RecipeEditor
              breadTypeId={editingType.id}
              defaultReferenceWeight={
                typeDetailSizes.find((s) => s.enabled && s.weightGrams != null)?.weightGrams ?? null
              }
            />

            {/* Sizes */}
            {isBaker ? (
              typeDetailSizes.some((s) => s.enabled) && (
                <div className="border-t border-border pt-3">
                  <div className="text-sm font-medium text-muted-foreground mb-1.5">
                    {t('settings.enabled_sizes')}
                  </div>
                  <div className="text-sm space-y-0.5">
                    {typeDetailSizes
                      .filter((s) => s.enabled)
                      .map((s) => (
                        <div key={s.id} className="flex justify-between gap-2">
                          <span>
                            {s.name}
                            {s.weightGrams != null && (
                              <span className="text-xs text-muted-foreground ms-1.5 tabular-nums">
                                {s.weightGrams}g
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            ₪{s.priceOverride ?? s.price}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )
            ) : (
              <div className="border-t border-border pt-3">
                <div className="text-sm font-medium text-muted-foreground mb-2">
                  {t('settings.enabled_sizes')}
                </div>
                {typeDetailSizes.length === 0 && (
                  <p className="text-xs text-muted-foreground italic px-2 py-3">
                    {t('settings.no_enabled_sizes')}
                  </p>
                )}
                <div className="space-y-1.5">
                  {typeDetailSizes.map((s) => (
                    <div
                      key={s.id}
                      className={cn(
                        'rounded-lg border p-2.5 transition-colors',
                        s.enabled ? 'bg-card border-border' : 'bg-muted/30 border-border/50'
                      )}
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={() => toggleEnabled(s.id)}
                          className="h-4 w-4 accent-primary cursor-pointer"
                        />
                        <span className={cn('text-sm font-medium flex-1', !s.enabled && 'text-muted-foreground')}>
                          {s.name}
                          {s.weightGrams != null && (
                            <span className="text-xs text-muted-foreground ms-1.5 tabular-nums">{s.weightGrams}g</span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          ₪{s.price}
                        </span>
                      </label>
                      {s.enabled && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">
                            {t('settings.price_override')}
                          </span>
                          <Input
                            type="number"
                            inputMode="decimal"
                            value={s.priceOverride ?? ''}
                            onChange={(e) => updateOverride(s.id, e.target.value)}
                            placeholder={`₪${s.price}`}
                            className="flex-1 max-w-32"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Additions */}
            {isBaker ? (
              typeDetailAdditions.some((a) => a.enabled) && (
                <div className="border-t border-border pt-3">
                  <div className="text-sm font-medium text-muted-foreground mb-1.5">
                    {t('settings.enabled_additions')}
                  </div>
                  <div className="text-sm">
                    {typeDetailAdditions
                      .filter((a) => a.enabled)
                      .map((a) => a.name)
                      .join(' · ')}
                  </div>
                </div>
              )
            ) : (
              typeDetailAdditions.length > 0 && (
                <div className="border-t border-border pt-3">
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    {t('settings.enabled_additions')}
                  </div>
                  <div className="space-y-1.5">
                    {typeDetailAdditions.map((a) => (
                      <label
                        key={a.id}
                        className={cn(
                          'flex items-center gap-2.5 cursor-pointer rounded-lg border p-2.5 transition-colors',
                          a.enabled ? 'bg-card border-border' : 'bg-muted/30 border-border/50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={a.enabled}
                          onChange={() => toggleAdditionEnabledForType(a.id)}
                          className="h-4 w-4 accent-primary cursor-pointer"
                        />
                        <span className={cn('text-sm font-medium flex-1', !a.enabled && 'text-muted-foreground')}>
                          {a.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            )}

            {/* Save / Delete (managers only) */}
            {!isBaker && (
              <div className="flex gap-2 items-center pt-1">
                <Button size="sm" className="flex-1" loading={savingType} onClick={() => saveType(editingType.id)}>
                  {t('settings.save')}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 h-8 w-8"
                  onClick={() => {
                    if (window.confirm('למחוק את הלחם? פעולה זו בלתי הפיכה.')) deleteType(editingType.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
