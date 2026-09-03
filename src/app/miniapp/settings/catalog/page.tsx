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
import Link from 'next/link';
import {
  Pencil, Plus, Pause, Play, Trash2, ChevronUp, ChevronDown, ChevronRight, ChevronLeft,
  Star, Download, Copy, X, Coins,
} from 'lucide-react';
import { DocketStub, docketWidth } from '@/components/ui/DocketStub';
import { BreadSheet } from '@/components/catalog/BreadSheet';
import type { MediaAsset } from '@/components/site-editor/MediaLibrary';
import { effectivePrice } from '@/lib/pricing';
import type { Tier } from '@/components/catalog/types';

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
  // Just the count, so the link can say whether anything is priced yet.
  const [pricedCount, setPricedCount] = useState<number | null>(null);

  // Export the pricelist as a Hebrew-keyed JSON (for feeding an LLM).
  const [exporting, setExporting] = useState(false);
  async function fetchExportJson(): Promise<string> {
    const data = await apiFetch<Record<string, unknown>>('/catalog/export');
    return JSON.stringify(data, null, 2);
  }
  async function downloadCatalog() {
    setExporting(true);
    try {
      // Inside Telegram, mint a short-lived signed token + use the native
      // download dialog (in-page blob downloads get "opened" not saved there).
      const tg = (
        window as unknown as {
          Telegram?: { WebApp?: { downloadFile?: (p: { url: string; file_name: string }) => void } };
        }
      ).Telegram?.WebApp;
      if (typeof tg?.downloadFile === 'function') {
        const { url } = await apiFetch<{ url: string }>('/catalog/export/token');
        tg.downloadFile({ url: `${window.location.origin}${url}`, file_name: 'pricelist.json' });
        return;
      }

      // Regular browser: blob download (octet-stream forces a save).
      const json = await fetchExportJson();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pricelist.json';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 1500);
    } catch {
      toast.error(t('catalog.export_failed'));
    } finally {
      setExporting(false);
    }
  }
  async function copyCatalog() {
    setExporting(true);
    try {
      const json = await fetchExportJson();
      try {
        await navigator.clipboard.writeText(json);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = json;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast.success(t('catalog.copied'));
    } catch {
      toast.error(t('catalog.export_failed'));
    } finally {
      setExporting(false);
    }
  }

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

  // ---- Bulk-pricing tiers (per size; null bread = default) ----
  const [tiers, setTiers] = useState<Tier[]>([]);

  async function saveTier(breadSizeId: number, breadTypeId: number | null, minQty: number, price: string) {
    try {
      const { tier } = await apiFetch<{ tier: Tier }>('/bread-size-tiers', {
        method: 'POST',
        body: JSON.stringify({ breadSizeId, breadTypeId, minQty, price }),
      });
      setTiers((prev) => [
        ...prev.filter(
          (x) => !(x.breadSizeId === breadSizeId && (x.breadTypeId ?? null) === breadTypeId && x.minQty === minQty)
        ),
        tier,
      ]);
    } catch {
      toast.error(t('catalog.tier_save_failed'));
    }
  }

  async function deleteTier(id: number) {
    try {
      await apiFetch(`/bread-size-tiers/${id}`, { method: 'DELETE' });
      setTiers((prev) => prev.filter((x) => x.id !== id));
    } catch {
      toast.error(t('catalog.tier_save_failed'));
    }
  }

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
  // Only which bread is open. Everything inside the sheet — sizes, additions,
  // branding, and their drafts — belongs to BreadSheet.
  const [expandedTypeId, setExpandedTypeId] = useState<number | null>(null);
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [addingType, setAddingType] = useState(false);
  const [savingTypeOrder, setSavingTypeOrder] = useState(false);

  const [assets, setAssets] = useState<MediaAsset[]>([]);

  // Media library (for image pickers) — owner/manager only.
  useEffect(() => {
    if (!activeGroupId || isBaker) return;
    apiFetch<{ assets: MediaAsset[] }>('/media')
      .then((r) => setAssets(r.assets))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, isBaker]);

  useEffect(() => {
    if (!activeGroupId || isBaker) return;
    apiFetch<{ book: { pricePerKg: Record<string, number> } }>('/ingredient-prices?scope=book')
      .then((r) => setPricedCount(Object.keys(r.book.pricePerKg).length))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, isBaker]);

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

  useEffect(() => {
    if (!activeGroupId || isBaker) return;
    apiFetch<{ tiers: Tier[] }>('/bread-size-tiers')
      .then((r) => setTiers(r.tiers))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, isBaker]);

  async function saveAdditionsSurcharge(value: string) {
    if (!activeGroupId) return;
    const v = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(v)) {
      toast.error(t('catalog.invalid_amount'));
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
      toast.error(t('catalog.save_failed'));
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

  /**
   * The bread rows below carry their own copy of each size, loaded once with the
   * page — which is where their ₪ range comes from. Editing a size in the
   * catalog left every bread using it quoting the old price until a full reload,
   * so the catalog and the list have to be updated together.
   */
  function syncEnabledSize(id: number, next: Partial<EnabledSize> | null) {
    setBreadTypes((prev) =>
      prev.map((bt) => ({
        ...bt,
        enabledSizes: next
          ? bt.enabledSizes.map((s) => (s.id === id ? { ...s, ...next } : s))
          : bt.enabledSizes.filter((s) => s.id !== id),
      }))
    );
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
    syncEnabledSize(id, { name: size.name, weightGrams: size.weightGrams, price: size.price });
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
      // The endpoint drops the junction rows with it, so no bread offers it now.
      syncEnabledSize(id, null);
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

  function expandType(typeId: number) {
    setExpandedTypeId((prev) => (prev === typeId ? null : typeId));
  }

  async function moveType(id: number, dir: 'up' | 'down') {
    const idx = breadTypes.findIndex((bt) => bt.id === id);
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= breadTypes.length) return;
    const next = [...breadTypes];
    [next[idx], next[target]] = [next[target], next[idx]];
    setBreadTypes(next);
    setSavingTypeOrder(true);
    try {
      await apiFetch(`/groups/${activeGroupId}/bread-types/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: next.map((bt) => bt.id) }),
      });
    } catch {
      toast.error(t('settings.reorder_failed'));
    } finally {
      setSavingTypeOrder(false);
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
      // The sheet loads the detail itself, including the auto-enabled defaults.
      setExpandedTypeId(breadType.id);
      setNewTypeName('');
      setShowAddType(false);
    } catch {
      toast.error(t('catalog.save_failed'));
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
      toast.error(t('catalog.save_failed'));
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
        {/* Ingredient costs — its own screen, so this page doesn't grow a
            fourth CRUD domain. Managers only; the endpoint 403s for bakers. */}
        {!isBaker && (
          <Link
            href="/miniapp/settings/catalog/costs"
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50"
          >
            <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t('costs.open')}</span>
              <span className="block text-[11px] text-muted-foreground">
                {pricedCount === null
                  ? ''
                  : pricedCount === 0
                    ? t('costs.open_hint_none')
                    : `${pricedCount} ${t('costs.open_hint')}`}
              </span>
            </span>
            <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        )}

        {/* Pricelist JSON export (managers only) */}
        {!isBaker && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <span className="text-sm font-medium text-muted-foreground">{t('catalog.export')}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={downloadCatalog}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {t('catalog.download')}
              </button>
              <button
                type="button"
                onClick={copyCatalog}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
                {t('catalog.copy')}
              </button>
            </div>
          </div>
        )}

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
          {sizes.length === 0 ? (
            <Card className="text-sm text-muted-foreground italic text-center py-6">
              —
            </Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              {sizes.map((s, idx) => (
                <div key={s.id} className={cn(idx > 0 && 'border-t border-dashed border-border')}>
                  {editingSizeId === s.id ? (
                  <div className="animate-expand p-3 space-y-3">
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
                  </div>
                ) : (
                  <>
                  <div className="flex items-stretch">
                    <DocketStub id={s.id} width={docketWidth(sizes.map((x) => x.id))} />
                    <div className="flex flex-1 items-center gap-2 px-3 py-2.5 min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
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
                    </div>
                  </div>
                  <div className="px-3 pb-3 pt-2 border-t border-dashed border-border/50">
                    <TierEditor
                      tiers={tiers}
                      sizeId={s.id}
                      breadTypeId={null}
                      onSave={(q, p) => saveTier(s.id, null, q, p)}
                      onDelete={deleteTier}
                      t={t}
                    />
                  </div>
                  </>
                  )}
                </div>
              ))}
            </Card>
          )}

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
          {additions.length === 0 ? (
            <Card className="text-sm text-muted-foreground italic text-center py-6">—</Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              {additions.map((a, idx) =>
                editingAdditionId === a.id ? (
                  <div
                    key={a.id}
                    className={cn('animate-expand p-3 space-y-3', idx > 0 && 'border-t border-dashed border-border')}
                  >
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
                  </div>
                ) : (
                  <div
                    key={a.id}
                    className={cn('flex items-stretch', idx > 0 && 'border-t border-dashed border-border')}
                  >
                    <DocketStub id={a.id} width={docketWidth(additions.map((x) => x.id))} />
                    <div className="flex flex-1 items-center gap-2 px-3 py-2.5 min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
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
                    </div>
                  </div>
                )
              )}
            </Card>
          )}

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
                .map((s) => Number(effectivePrice(s)))
                .filter((n) => !Number.isNaN(n));
              const low = priced.length ? Math.min(...priced) : null;
              const high = priced.length ? Math.max(...priced) : null;
              return (
                <div
                  key={bt.id}
                  className={cn(
                    'flex items-stretch',
                    idx > 0 && 'border-t border-dashed border-border'
                  )}
                >
                  <DocketStub id={bt.id} width={docketWidth(breadTypes.map((b) => b.id))} />
                  {!isBaker && (
                    <div className="flex flex-col justify-center shrink-0 ps-1 -my-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={savingTypeOrder || idx === 0}
                        onClick={() => moveType(bt.id, 'up')}
                        aria-label="up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={savingTypeOrder || idx === breadTypes.length - 1}
                        onClick={() => moveType(bt.id, 'down')}
                        aria-label="down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="flex items-center gap-2 flex-1 text-start min-w-0 px-3.5 py-3"
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
                      className="shrink-0 self-center me-1"
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

      {/* The bread editor. Everything about one bread, one section at a time,
          each section saving itself. */}
      {editingType && activeGroupId && (
        <BreadSheet
          typeId={editingType.id}
          typeName={editingType.name}
          groupId={activeGroupId}
          isBaker={isBaker}
          assets={assets}
          tiers={tiers}
          onClose={() => setExpandedTypeId(null)}
          onNameSaved={(name) =>
            setBreadTypes((prev) =>
              prev.map((bt) => (bt.id === editingType.id ? { ...bt, name } : bt))
            )
          }
          onSizesSaved={(sizes) =>
            setBreadTypes((prev) =>
              prev.map((bt) =>
                bt.id === editingType.id
                  ? {
                      ...bt,
                      enabledSizes: sizes
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
                  : bt
              )
            )
          }
          onAdditionsSaved={(additions) =>
            setBreadTypes((prev) =>
              prev.map((bt) =>
                bt.id === editingType.id
                  ? {
                      ...bt,
                      enabledAdditions: additions
                        .filter((a) => a.enabled)
                        .map((a) => ({ id: a.id, name: a.name, isActive: true })),
                    }
                  : bt
              )
            )
          }
          onTiersSaved={setTiers}
          onDeleted={() => {
            setBreadTypes((prev) => prev.filter((bt) => bt.id !== editingType.id));
            setExpandedTypeId(null);
          }}
        />
      )}
    </>
  );
}

// Compact bulk-tier editor: existing tiers as deletable chips + an add row.
// Editing a tier = re-adding the same qty (the API upsert overwrites it).
function TierEditor({
  tiers,
  sizeId,
  breadTypeId,
  onSave,
  onDelete,
  t,
}: {
  tiers: Tier[];
  sizeId: number;
  breadTypeId: number | null;
  onSave: (minQty: number, price: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  t: (key: string) => string;
}) {
  const rows = tiers
    .filter((x) => x.breadSizeId === sizeId && (x.breadTypeId ?? null) === breadTypeId)
    .sort((a, b) => a.minQty - b.minQty);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);

  const canAdd = Number.isInteger(Number(qty)) && Number(qty) >= 2 && /^\d+(\.\d{1,2})?$/.test(price.trim());

  async function add() {
    if (!canAdd) return;
    setSaving(true);
    try {
      await onSave(parseInt(qty, 10), price.trim());
      setQty('');
      setPrice('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{t('catalog.tiers')}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground/70">{t('catalog.tier_none')}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium tabular-nums"
            >
              {r.minQty} → ₪{r.price}
              <button
                type="button"
                aria-label={t('settings.delete')}
                onClick={() => onDelete(r.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="w-16">
          <Input
            label={t('catalog.tier_qty')}
            type="number"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
          />
        </div>
        <div className="w-24">
          <Input
            label={t('catalog.tier_price')}
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => { void add(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
          />
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="mb-0.5"
          disabled={!canAdd || saving}
          onClick={add}
          aria-label={t('catalog.tier_add')}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {breadTypeId === null && (
        <div className="text-[11px] text-muted-foreground/70">{t('catalog.tier_default_hint')}</div>
      )}
    </div>
  );
}
