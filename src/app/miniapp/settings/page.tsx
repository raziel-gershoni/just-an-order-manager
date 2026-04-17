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
import { Copy, Check, Pencil, Plus, Pause, Play, Trash2 } from 'lucide-react';
import { getInitial } from '@/lib/name-utils';

interface BreadType { id: number; name: string; price: string; isActive: boolean; sortOrder: number }
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
    setBreadTypes((prev) => prev.map((bt) => (bt.id === id ? breadType : bt)));
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
      prev.map((bt) => (bt.id === id ? breadType : bt))
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder || a.id - b.id)
    );
    setTimeout(() => setJustToggledId(null), 400);
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
              <Card key={bt.id} className={cn('flex justify-between items-center', justToggledId === bt.id && 'animate-reorder')}>
                <div className="flex items-center gap-2">
                  <span className={cn('font-medium', !bt.isActive && 'text-muted-foreground line-through')}>{bt.name}</span>
                  <span className={cn(
                    'text-xs font-medium px-2 py-0.5 rounded-full tabular-nums',
                    bt.isActive ? 'bg-muted text-muted-foreground' : 'bg-muted/50 text-muted-foreground/50'
                  )}>
                    ₪{bt.price}
                  </span>
                  {!bt.isActive && (
                    <span className="text-xs text-muted-foreground">({t('settings.inactive')})</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setEditingBreadId(bt.id); setEditBreadName(bt.name); setEditBreadPrice(bt.price); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => toggleBreadType(bt.id, bt.isActive)}>
                    {bt.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </Card>
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
