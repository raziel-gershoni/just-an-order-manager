'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { Copy, Check, Pencil, Plus, Pause, Play, Trash2, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react';
import { getInitial } from '@/lib/name-utils';

interface BreadSize { id: number; breadTypeId: number; name: string; weightGrams: number | null; price: string; isActive: boolean; sortOrder: number }
interface BreadType { id: number; name: string; price: string; isActive: boolean; sortOrder: number; sizes?: BreadSize[] }
interface Member { id: number; userId: number; name: string; role: string }
interface Invite { id: number; inviteCode: string; role: string; status: string }

export default function SettingsPage() {
  const { apiFetch } = useApi();
  const { activeGroupId } = useGroup();
  const t = useT();
  const toast = useToast();
  const [breadTypes, setBreadTypes] = useState<BreadType[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const [groupName, setGroupName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [editingBreadId, setEditingBreadId] = useState<number | null>(null);
  const [editBreadName, setEditBreadName] = useState('');
  const [editBreadPrice, setEditBreadPrice] = useState('');

  const [newBreadName, setNewBreadName] = useState('');
  const [newBreadPrice, setNewBreadPrice] = useState('');

  const [justToggledId, setJustToggledId] = useState<number | null>(null);
  const [justMovedId, setJustMovedId] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const [expandedTypeId, setExpandedTypeId] = useState<number | null>(null);
  const [editingSizeId, setEditingSizeId] = useState<number | null>(null);
  const [editSizeName, setEditSizeName] = useState('');
  const [editSizeWeight, setEditSizeWeight] = useState('');
  const [editSizePrice, setEditSizePrice] = useState('');
  const [addSizeForType, setAddSizeForType] = useState<number | null>(null);
  const [newSizeName, setNewSizeName] = useState('');
  const [newSizeWeight, setNewSizeWeight] = useState('');
  const [newSizePrice, setNewSizePrice] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'baker'>('baker');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!activeGroupId) return;
    Promise.all([
      apiFetch<{ group: { name: string }; role: string }>(`/groups/${activeGroupId}`),
      apiFetch<{ breadTypes: BreadType[] }>(`/groups/${activeGroupId}/bread-types`),
      apiFetch<{ members: Member[] }>(`/groups/${activeGroupId}/members`),
      apiFetch<{ invites: Invite[] }>(`/groups/${activeGroupId}/invites`),
    ])
      .then(([g, b, m, i]) => {
        setGroupName(g.group.name);
        setBreadTypes(
          [...b.breadTypes].sort((a: BreadType, b: BreadType) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder || a.id - b.id)
        );
        setMembers(m.members);
        setInvites(i.invites);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId]);

  async function saveBreadType(id: number) {
    if (!editBreadName.trim() || !editBreadPrice) return;
    const { breadType } = await apiFetch<{ breadType: BreadType }>(`/bread-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editBreadName.trim(), price: editBreadPrice }),
    });
    setBreadTypes((prev) => prev.map((bt) => (bt.id === id ? { ...breadType, sizes: bt.sizes } : bt)));
    setEditingBreadId(null);
  }

  async function deleteBreadType(id: number) {
    try {
      await apiFetch(`/bread-types/${id}?hard=true`, { method: 'DELETE' });
      setBreadTypes((prev) => prev.filter((bt) => bt.id !== id));
      setEditingBreadId(null);
      toast.success(t('settings.deleted'));
    } catch {
      toast.error(t('settings.delete_failed'));
    }
  }

  async function toggleBreadType(id: number, isActive: boolean) {
    const { breadType } = await apiFetch<{ breadType: BreadType }>(`/bread-types/${id}`, {
      method: isActive ? 'DELETE' : 'PATCH',
      ...(!isActive && { body: JSON.stringify({ isActive: true }) }),
    });
    setJustToggledId(id);
    setBreadTypes((prev) =>
      prev.map((bt) => (bt.id === id ? { ...breadType, sizes: bt.sizes } : bt))
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder || a.id - b.id)
    );
    setTimeout(() => setJustToggledId(null), 400);
  }

  // ---- Sizes ----

  async function addSize(typeId: number) {
    if (!newSizeName.trim() || !newSizePrice) return;
    const { size } = await apiFetch<{ size: BreadSize }>(
      `/groups/${activeGroupId}/bread-types/${typeId}/sizes`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: newSizeName.trim(),
          weightGrams: newSizeWeight ? Number(newSizeWeight) : null,
          price: newSizePrice,
        }),
      }
    );
    setBreadTypes((prev) =>
      prev.map((bt) => (bt.id === typeId ? { ...bt, sizes: [...(bt.sizes || []), size] } : bt))
    );
    setNewSizeName('');
    setNewSizeWeight('');
    setNewSizePrice('');
    setAddSizeForType(null);
  }

  async function saveSize(typeId: number, sizeId: number) {
    if (!editSizeName.trim() || !editSizePrice) return;
    const { size } = await apiFetch<{ size: BreadSize }>(`/bread-sizes/${sizeId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: editSizeName.trim(),
        weightGrams: editSizeWeight ? Number(editSizeWeight) : null,
        price: editSizePrice,
      }),
    });
    setBreadTypes((prev) =>
      prev.map((bt) =>
        bt.id === typeId
          ? { ...bt, sizes: (bt.sizes || []).map((s) => (s.id === sizeId ? size : s)) }
          : bt
      )
    );
    setEditingSizeId(null);
  }

  async function deleteSize(typeId: number, sizeId: number) {
    try {
      await apiFetch(`/bread-sizes/${sizeId}?hard=true`, { method: 'DELETE' });
      setBreadTypes((prev) =>
        prev.map((bt) =>
          bt.id === typeId ? { ...bt, sizes: (bt.sizes || []).filter((s) => s.id !== sizeId) } : bt
        )
      );
      setEditingSizeId(null);
      toast.success(t('settings.deleted'));
    } catch {
      toast.error(t('settings.delete_failed'));
    }
  }

  async function toggleSize(typeId: number, sizeId: number, isActive: boolean) {
    const { size } = await apiFetch<{ size: BreadSize }>(`/bread-sizes/${sizeId}`, {
      method: isActive ? 'DELETE' : 'PATCH',
      ...(!isActive && { body: JSON.stringify({ isActive: true }) }),
    });
    setBreadTypes((prev) =>
      prev.map((bt) =>
        bt.id === typeId
          ? {
              ...bt,
              sizes: (bt.sizes || [])
                .map((s) => (s.id === sizeId ? size : s))
                .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder || a.id - b.id),
            }
          : bt
      )
    );
  }

  async function moveSize(typeId: number, sizeId: number, direction: 'up' | 'down') {
    const type = breadTypes.find((bt) => bt.id === typeId);
    if (!type?.sizes) return;
    const sorted = [...type.sizes];
    const idx = sorted.findIndex((s) => s.id === sizeId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    if (sorted[idx].isActive !== sorted[targetIdx].isActive) return;

    [sorted[idx], sorted[targetIdx]] = [sorted[targetIdx], sorted[idx]];
    const reordered = sorted.map((s, i) => ({ ...s, sortOrder: i }));
    setBreadTypes((prev) =>
      prev.map((bt) => (bt.id === typeId ? { ...bt, sizes: reordered } : bt))
    );

    try {
      await apiFetch(`/groups/${activeGroupId}/bread-types/${typeId}/sizes/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: reordered.map((s) => s.id) }),
      });
    } catch {
      toast.error(t('settings.reorder_failed'));
    }
  }

  async function addBreadType() {
    if (!newBreadName || !newBreadPrice || !activeGroupId) return;
    const { breadType } = await apiFetch<{ breadType: BreadType }>(
      `/groups/${activeGroupId}/bread-types`,
      { method: 'POST', body: JSON.stringify({ name: newBreadName, price: newBreadPrice }) }
    );
    setBreadTypes((prev) => [...prev, breadType]);
    setNewBreadName('');
    setNewBreadPrice('');
  }

  async function moveBreadType(id: number, direction: 'up' | 'down') {
    const sorted = [...breadTypes];
    const idx = sorted.findIndex((bt) => bt.id === id);
    if (idx < 0) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;

    // Don't swap across active/inactive boundary
    if (sorted[idx].isActive !== sorted[targetIdx].isActive) return;

    [sorted[idx], sorted[targetIdx]] = [sorted[targetIdx], sorted[idx]];
    const reordered = sorted.map((bt, i) => ({ ...bt, sortOrder: i }));
    setBreadTypes(reordered);

    setJustMovedId(id);
    setTimeout(() => setJustMovedId(null), 400);

    setSavingOrder(true);
    try {
      await apiFetch(`/groups/${activeGroupId}/bread-types/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: reordered.map((bt) => bt.id) }),
      });
    } catch {
      toast.error(t('settings.reorder_failed'));
    } finally {
      setSavingOrder(false);
    }
  }

  async function createInvite() {
    if (!activeGroupId) return;
    const result = await apiFetch<{ invite: Invite; inviteLink: string | null }>(
      `/groups/${activeGroupId}/invites`,
      { method: 'POST', body: JSON.stringify({ role: inviteRole }) }
    );
    setInvites((prev) => [...prev, result.invite]);
    setInviteLink(result.inviteLink);
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="p-5 space-y-4">
        <div className="h-8 w-32 rounded bg-muted animate-pulse" />
        <div className="h-20 rounded-xl bg-muted animate-pulse" />
        <div className="h-20 rounded-xl bg-muted animate-pulse" />
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6 animate-fade-in">
      <h1 className="text-xl font-bold tracking-tight">{t('settings.title')}</h1>

      {/* Group Name */}
      <section>
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">
          {t('settings.group_name')}
        </h2>
        <Card>
          <div className="flex gap-2">
            <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} className="flex-1" />
            <Button
              size="sm"
              disabled={!groupName.trim()}
              loading={savingName}
              onClick={async () => {
                if (!activeGroupId || !groupName.trim()) return;
                setSavingName(true);
                try {
                  await apiFetch(`/groups/${activeGroupId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ name: groupName.trim() }),
                  });
                } catch {}
                setSavingName(false);
              }}
            >
              {t('settings.save')}
            </Button>
          </div>
        </Card>
      </section>

      {/* Members */}
      <section>
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">
          {t('settings.members')}
        </h2>
        <Card className="divide-y divide-border p-0">
          {members.map((m) => (
            <div key={m.id} className="flex justify-between items-center px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                  {getInitial(m.name)}
                </div>
                <span className="font-medium">{m.name}</span>
              </div>
              <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {t(`role.${m.role}`)}
              </span>
            </div>
          ))}
        </Card>
      </section>

      {/* Invite */}
      <section>
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">
          {t('settings.invite')}
        </h2>
        <Card>
          <div className="flex gap-1 bg-muted p-1 rounded-lg mb-3">
            {(['baker', 'manager'] as const).map((role) => (
              <button
                key={role}
                className={cn(
                  'flex-1 py-2 rounded-md text-sm font-medium transition-all',
                  inviteRole === role
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setInviteRole(role)}
              >
                {t(`role.${role}`)}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={createInvite}>{t('settings.create_invite')}</Button>
          {inviteLink && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-muted rounded-lg">
              <span className="text-sm break-all flex-1 text-muted-foreground">{inviteLink}</span>
              <Button size="icon" variant="ghost" onClick={copyInviteLink}>
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </Card>
      </section>

      {/* Bread Types */}
      <section>
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">
          {t('settings.bread_types')}
        </h2>
        <div className="space-y-2">
          {breadTypes.map((bt) =>
            editingBreadId === bt.id ? (
              <Card key={bt.id} className="animate-expand">
                <div className="flex gap-2 mb-3">
                  <Input placeholder={t('settings.name')} value={editBreadName} onChange={(e) => setEditBreadName(e.target.value)} className="flex-1" />
                  <Input placeholder={t('settings.price')} type="number" value={editBreadPrice} onChange={(e) => setEditBreadPrice(e.target.value)} className="w-24" />
                </div>
                <div className="flex gap-2 items-center">
                  <Button size="sm" onClick={() => saveBreadType(bt.id)}>{t('settings.save')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingBreadId(null)}>{t('payments.cancel')}</Button>
                  <div className="flex-1" />
                  <Button size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => deleteBreadType(bt.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ) : (
              <div key={bt.id} className="space-y-1">
                <Card className={cn('flex justify-between items-center', (justToggledId === bt.id || justMovedId === bt.id) && 'animate-reorder')}>
                  <button
                    type="button"
                    className="flex items-center gap-2 flex-1 text-start"
                    onClick={() => setExpandedTypeId(expandedTypeId === bt.id ? null : bt.id)}
                  >
                    <div className="flex flex-col -my-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={savingOrder || breadTypes.findIndex((b) => b.isActive === bt.isActive) === breadTypes.indexOf(bt)}
                        onClick={(e) => { e.stopPropagation(); moveBreadType(bt.id, 'up'); }}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={savingOrder || breadTypes.findLastIndex((b) => b.isActive === bt.isActive) === breadTypes.indexOf(bt)}
                        onClick={(e) => { e.stopPropagation(); moveBreadType(bt.id, 'down'); }}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform',
                        expandedTypeId === bt.id && 'rotate-90'
                      )}
                    />
                    <span className={cn('font-medium', !bt.isActive && 'text-muted-foreground line-through')}>{bt.name}</span>
                    {bt.sizes && bt.sizes.length > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        ({bt.sizes.length})
                      </span>
                    )}
                    {!bt.isActive && (
                      <span className="text-xs text-muted-foreground">({t('settings.inactive')})</span>
                    )}
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => { setEditingBreadId(bt.id); setEditBreadName(bt.name); setEditBreadPrice(bt.price); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => toggleBreadType(bt.id, bt.isActive)}>
                      {bt.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </Card>

                {/* Sizes panel */}
                {expandedTypeId === bt.id && (
                  <div className="ms-6 space-y-1.5 animate-expand">
                    {(!bt.sizes || bt.sizes.length === 0) && (
                      <p className="text-xs text-muted-foreground italic px-3 py-2">
                        {t('settings.no_sizes')}
                      </p>
                    )}
                    {bt.sizes?.map((s) => (
                      editingSizeId === s.id ? (
                        <Card key={s.id} className="animate-expand p-3 space-y-3">
                          <Input
                            label={t('settings.size_name')}
                            value={editSizeName}
                            onChange={(e) => setEditSizeName(e.target.value)}
                            placeholder="1kg"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              label={t('settings.weight')}
                              type="number"
                              inputMode="numeric"
                              value={editSizeWeight}
                              onChange={(e) => setEditSizeWeight(e.target.value)}
                              placeholder="1000"
                            />
                            <Input
                              label={t('settings.price')}
                              type="number"
                              inputMode="decimal"
                              value={editSizePrice}
                              onChange={(e) => setEditSizePrice(e.target.value)}
                              placeholder="35"
                            />
                          </div>
                          <div className="flex gap-2 items-center pt-1">
                            <Button size="sm" className="flex-1" onClick={() => saveSize(bt.id, s.id)}>{t('settings.save')}</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingSizeId(null)}>{t('payments.cancel')}</Button>
                            <Button size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10 h-8 w-8" onClick={() => deleteSize(bt.id, s.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </Card>
                      ) : (
                        <Card key={s.id} className="flex justify-between items-center p-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col -my-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5"
                                disabled={(bt.sizes ?? []).findIndex((x) => x.isActive === s.isActive) === (bt.sizes ?? []).indexOf(s)}
                                onClick={() => moveSize(bt.id, s.id, 'up')}
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5"
                                disabled={(bt.sizes ?? []).findLastIndex((x) => x.isActive === s.isActive) === (bt.sizes ?? []).indexOf(s)}
                                onClick={() => moveSize(bt.id, s.id, 'down')}
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </div>
                            <span className={cn('text-sm font-medium', !s.isActive && 'text-muted-foreground line-through')}>{s.name}</span>
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
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingSizeId(s.id); setEditSizeName(s.name); setEditSizeWeight(s.weightGrams != null ? String(s.weightGrams) : ''); setEditSizePrice(s.price); }}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleSize(bt.id, s.id, s.isActive)}>
                              {s.isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                            </Button>
                          </div>
                        </Card>
                      )
                    ))}
                    {addSizeForType === bt.id ? (
                      <Card className="animate-expand p-3 space-y-3">
                        <Input
                          label={t('settings.size_name')}
                          value={newSizeName}
                          onChange={(e) => setNewSizeName(e.target.value)}
                          placeholder="1kg"
                          autoFocus
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            label={t('settings.weight')}
                            type="number"
                            inputMode="numeric"
                            value={newSizeWeight}
                            onChange={(e) => setNewSizeWeight(e.target.value)}
                            placeholder="1000"
                          />
                          <Input
                            label={t('settings.price')}
                            type="number"
                            inputMode="decimal"
                            value={newSizePrice}
                            onChange={(e) => setNewSizePrice(e.target.value)}
                            placeholder="35"
                          />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" className="flex-1" onClick={() => addSize(bt.id)}>{t('form.add')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setAddSizeForType(null); setNewSizeName(''); setNewSizeWeight(''); setNewSizePrice(''); }}>{t('payments.cancel')}</Button>
                        </div>
                      </Card>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs"
                        onClick={() => setAddSizeForType(bt.id)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('settings.add_size')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
        <Card className="mt-3">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            {t('settings.add_bread')}
          </h3>
          <div className="flex gap-2">
            <Input placeholder={t('settings.name')} value={newBreadName} onChange={(e) => setNewBreadName(e.target.value)} className="flex-1" />
            <Input placeholder={t('settings.price')} type="number" value={newBreadPrice} onChange={(e) => setNewBreadPrice(e.target.value)} className="w-24" />
            <Button size="sm" onClick={addBreadType}>{t('form.add')}</Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
