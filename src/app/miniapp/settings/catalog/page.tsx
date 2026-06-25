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
  Star, Check, Download, Copy,
} from 'lucide-react';
import { RecipeEditor } from '@/components/RecipeEditor';
import { DocketStub, docketWidth } from '@/components/ui/DocketStub';
import { BadgePicker } from '@/components/site-editor/BadgePicker';
import { ImagePicker } from '@/components/site-editor/ImagePicker';
import type { MediaAsset } from '@/components/site-editor/MediaLibrary';

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
  badgeType: string | null;
  badgeLabel: string | null;
  badgeIcon: string | null;
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
  const [savingTypeOrder, setSavingTypeOrder] = useState(false);

  // ---- Public-site badge + image for the expanded type ----
  const [typeBadgeType, setTypeBadgeType] = useState<string | null>(null);
  const [typeBadgeLabel, setTypeBadgeLabel] = useState<string | null>(null);
  const [typeBadgeIcon, setTypeBadgeIcon] = useState<string | null>(null);
  const [typeImageId, setTypeImageId] = useState<number | null>(null);
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

    const { breadType } = await apiFetch<{
      breadType: {
        sizes: TypeDetailSize[];
        additions: TypeDetailAddition[];
        badgeType: string | null;
        badgeLabel: string | null;
        badgeIcon: string | null;
        imageId: number | null;
      };
    }>(`/groups/${activeGroupId}/bread-types/${typeId}`);
    setTypeDetailSizes(breadType.sizes);
    setTypeDetailAdditions(breadType.additions);
    setTypeBadgeType(breadType.badgeType);
    setTypeBadgeLabel(breadType.badgeLabel);
    setTypeBadgeIcon(breadType.badgeIcon);
    setTypeImageId(breadType.imageId);
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

  function updateSizeBadge(
    sizeId: number,
    type: string | null,
    label: string | null,
    icon: string | null
  ) {
    setTypeDetailSizes((prev) =>
      prev.map((s) =>
        s.id === sizeId ? { ...s, badgeType: type, badgeLabel: label, badgeIcon: icon } : s
      )
    );
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
      // Save name (if changed) + the public-site badge & image in one PATCH.
      const original = breadTypes.find((t) => t.id === typeId);
      const patch: Record<string, unknown> = {
        badgeType: typeBadgeType,
        badgeLabel: typeBadgeType === 'custom' ? (typeBadgeLabel?.trim() || null) : null,
        badgeIcon: typeBadgeIcon,
        imageId: typeImageId,
      };
      if (original && typeNameDraft.trim() && typeNameDraft.trim() !== original.name) {
        patch.name = typeNameDraft.trim();
      }
      const { breadType } = await apiFetch<{ breadType: BreadType }>(
        `/bread-types/${typeId}`,
        { method: 'PATCH', body: JSON.stringify(patch) }
      );
      setBreadTypes((prev) =>
        prev.map((t) => (t.id === typeId ? { ...t, name: breadType.name } : t))
      );

      // Save enabled sizes (+ per-size badge)
      const enabledSizes = typeDetailSizes
        .filter((s) => s.enabled)
        .map((s) => ({
          breadSizeId: s.id,
          priceOverride: s.priceOverride && s.priceOverride !== s.price ? s.priceOverride : null,
          badgeType: s.badgeType,
          badgeLabel: s.badgeType === 'custom' ? (s.badgeLabel?.trim() || null) : null,
          badgeIcon: s.badgeIcon,
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
      toast.success('הלחם נשמר');
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
              {sizes.map((s, idx) =>
                editingSizeId === s.id ? (
                  <div
                    key={s.id}
                    className={cn('animate-expand p-3 space-y-3', idx > 0 && 'border-t border-dashed border-border')}
                  >
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
                  <div
                    key={s.id}
                    className={cn('flex items-stretch', idx > 0 && 'border-t border-dashed border-border')}
                  >
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
                )
              )}
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
                .map((s) => Number(s.priceOverride ?? s.price))
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

            {/* Public-site branding: badge + image (managers only) */}
            {!isBaker && (
              <div className="border-t border-border pt-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">{t('site.type_branding')}</span>
                  <ImagePicker value={typeImageId} assets={assets} onChange={setTypeImageId} />
                </div>
                <BadgePicker
                  badgeType={typeBadgeType}
                  badgeLabel={typeBadgeLabel}
                  badgeIcon={typeBadgeIcon}
                  onChange={(type, label, icon) => {
                    setTypeBadgeType(type);
                    setTypeBadgeLabel(label);
                    setTypeBadgeIcon(icon);
                  }}
                />
              </div>
            )}

            {/* Recipe — surfaced near the top (primary use case) */}
            <RecipeEditor
              breadTypeId={editingType.id}
              defaultReferenceWeight={
                typeDetailSizes.find((s) => s.enabled && s.weightGrams != null)?.weightGrams ?? null
              }
            />

            {/* Sizes — tag cloud */}
            {isBaker ? (
              typeDetailSizes.some((s) => s.enabled) && (
                <div className="border-t border-border pt-3">
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    {t('settings.enabled_sizes')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {typeDetailSizes
                      .filter((s) => s.enabled)
                      .map((s) => (
                        <span
                          key={s.id}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm"
                        >
                          {s.name}
                          {s.weightGrams != null && (
                            <span className="text-xs text-muted-foreground tabular-nums">{s.weightGrams}g</span>
                          )}
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">· ₪{s.priceOverride ?? s.price}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )
            ) : (
              <div className="border-t border-border pt-3">
                <div className="text-sm font-medium text-muted-foreground mb-2">
                  {t('settings.enabled_sizes')}
                </div>
                {typeDetailSizes.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">
                    {t('settings.no_enabled_sizes')}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {typeDetailSizes.map((s) =>
                      s.enabled ? (
                        <div
                          key={s.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/15 px-3 py-1.5 text-sm font-medium text-foreground"
                        >
                          <button
                            type="button"
                            onClick={() => toggleEnabled(s.id)}
                            className="inline-flex items-center gap-1.5"
                          >
                            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>
                              {s.name}
                              {s.weightGrams != null && (
                                <span className="text-xs text-muted-foreground tabular-nums ms-0.5">{s.weightGrams}g</span>
                              )}
                            </span>
                          </button>
                          <span className="text-muted-foreground/60">·</span>
                          <span className="inline-flex items-center font-mono text-xs text-muted-foreground">
                            ₪
                            <input
                              type="number"
                              inputMode="decimal"
                              value={s.priceOverride ?? ''}
                              placeholder={s.price}
                              onChange={(e) => updateOverride(s.id, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`מחיר · ${s.name}`}
                              className="w-12 bg-transparent text-center tabular-nums text-foreground placeholder:text-muted-foreground/50 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </span>
                        </div>
                      ) : (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleEnabled(s.id)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/40"
                        >
                          <span>
                            {s.name}
                            {s.weightGrams != null && (
                              <span className="text-xs text-muted-foreground tabular-nums ms-0.5">{s.weightGrams}g</span>
                            )}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">· ₪{s.price}</span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Per-size badges for the public pricelist (managers only) */}
            {!isBaker && typeDetailSizes.some((s) => s.enabled) && (
              <div className="border-t border-border pt-3 space-y-3">
                <div className="text-sm font-medium text-muted-foreground">{t('site.size_badges')}</div>
                {typeDetailSizes
                  .filter((s) => s.enabled)
                  .map((s) => (
                    <div key={s.id} className="space-y-1.5">
                      <div className="text-xs font-semibold">
                        {s.name}
                        {s.weightGrams != null && (
                          <span className="text-muted-foreground tabular-nums"> · {s.weightGrams}g</span>
                        )}
                      </div>
                      <BadgePicker
                        badgeType={s.badgeType}
                        badgeLabel={s.badgeLabel}
                        badgeIcon={s.badgeIcon}
                        onChange={(type, label, icon) => updateSizeBadge(s.id, type, label, icon)}
                      />
                    </div>
                  ))}
              </div>
            )}

            {/* Additions — tag cloud */}
            {isBaker ? (
              typeDetailAdditions.some((a) => a.enabled) && (
                <div className="border-t border-border pt-3">
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    {t('settings.enabled_additions')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {typeDetailAdditions
                      .filter((a) => a.enabled)
                      .map((a) => (
                        <span
                          key={a.id}
                          className="inline-flex items-center rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm"
                        >
                          {a.name}
                        </span>
                      ))}
                  </div>
                </div>
              )
            ) : (
              typeDetailAdditions.length > 0 && (
                <div className="border-t border-border pt-3">
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    {t('settings.enabled_additions')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {typeDetailAdditions.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAdditionEnabledForType(a.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                          a.enabled
                            ? 'bg-primary/15 border-primary/50 text-foreground font-medium'
                            : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                        )}
                      >
                        {a.enabled && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        <span>{a.name}</span>
                      </button>
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
