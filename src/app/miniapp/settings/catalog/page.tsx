'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import {
  Pencil, Plus, Pause, Play, Trash2, ChevronUp, ChevronDown, ChevronRight,
  Star,
} from 'lucide-react';

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

interface BreadType {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  enabledSizes: EnabledSize[];
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

export default function CatalogPage() {
  const { apiFetch } = useApi();
  const { activeGroupId } = useGroup();
  const t = useT();
  const toast = useToast();

  const [sizes, setSizes] = useState<BreadSize[]>([]);
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

  // ---- Bread types state ----
  const [expandedTypeId, setExpandedTypeId] = useState<number | null>(null);
  const [typeDetailSizes, setTypeDetailSizes] = useState<TypeDetailSize[]>([]);
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
    ])
      .then(([typesResp, sizesResp]) => {
        setBreadTypes(typesResp.breadTypes);
        setSizes(sizesResp.sizes);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId]);

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

  // ============ BREAD TYPES ============

  async function expandType(typeId: number) {
    if (expandedTypeId === typeId) {
      setExpandedTypeId(null);
      return;
    }
    setExpandedTypeId(typeId);
    const type = breadTypes.find((t) => t.id === typeId);
    if (type) setTypeNameDraft(type.name);

    const { breadType } = await apiFetch<{ breadType: { sizes: TypeDetailSize[] } }>(
      `/groups/${activeGroupId}/bread-types/${typeId}`
    );
    setTypeDetailSizes(breadType.sizes);
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
      const enabled = typeDetailSizes
        .filter((s) => s.enabled)
        .map((s) => ({
          breadSizeId: s.id,
          priceOverride: s.priceOverride && s.priceOverride !== s.price ? s.priceOverride : null,
        }));
      await apiFetch(`/groups/${activeGroupId}/bread-types/${typeId}/sizes`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });

      // Update local breadTypes.enabledSizes for the count display
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
      const { breadType: detail } = await apiFetch<{ breadType: { sizes: TypeDetailSize[] } }>(
        `/groups/${activeGroupId}/bread-types/${breadType.id}`
      );
      setTypeDetailSizes(detail.sizes);
      setTypeNameDraft(breadType.name);
      setNewTypeName('');
      setShowAddType(false);
    } catch {
      toast.error(t('customers.save_failed'));
    } finally {
      setAddingType(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('settings.catalog')} />
        <div className="p-5 space-y-4">
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
          <div className="h-48 rounded-xl bg-muted animate-pulse" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('settings.catalog')} />
      <div className="p-5 space-y-6 animate-fade-in">
        {/* SIZES CATALOG */}
        <section>
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">
            {t('settings.global_sizes')}
          </h2>

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
        </section>

        {/* BREAD TYPES */}
        <section>
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">
            {t('settings.bread_types')}
          </h2>

          <div className="space-y-2">
            {breadTypes.map((bt) => (
              <div key={bt.id} className="space-y-1">
                <Card className="flex justify-between items-center">
                  <button
                    type="button"
                    className="flex items-center gap-2 flex-1 text-start min-w-0"
                    onClick={() => expandType(bt.id)}
                  >
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform shrink-0',
                        expandedTypeId === bt.id && 'rotate-90'
                      )}
                    />
                    <span className={cn('font-medium', !bt.isActive && 'text-muted-foreground line-through')}>
                      {bt.name}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      ({bt.enabledSizes.length})
                    </span>
                  </button>
                </Card>

                {expandedTypeId === bt.id && (
                  <Card className="animate-expand p-3 space-y-3 ms-3">
                    <Input
                      label={t('settings.name')}
                      value={typeNameDraft}
                      onChange={(e) => setTypeNameDraft(e.target.value)}
                    />

                    <div>
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

                    <div className="flex gap-2 items-center pt-1">
                      <Button size="sm" className="flex-1" loading={savingType} onClick={() => saveType(bt.id)}>
                        {t('settings.save')}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 h-8 w-8"
                        onClick={() => deleteType(bt.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                )}
              </div>
            ))}
          </div>

          {showAddType ? (
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
          )}
        </section>
      </div>
    </>
  );
}
