'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface BreadType { id: number; name: string; price: string; isActive: boolean }
interface Member { id: number; userId: number; name: string; role: string }
interface Invite { id: number; inviteCode: string; role: string; status: string }

export default function SettingsPage() {
  const { apiFetch } = useApi();
  const { activeGroupId } = useGroup();
  const t = useT();
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

  const [inviteRole, setInviteRole] = useState<'manager' | 'baker'>('baker');
  const [inviteLink, setInviteLink] = useState<string | null>(null);

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
        setBreadTypes(b.breadTypes);
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

  async function toggleBreadType(id: number, isActive: boolean) {
    const { breadType } = await apiFetch<{ breadType: BreadType }>(`/bread-types/${id}`, {
      method: isActive ? 'DELETE' : 'PATCH',
      ...(!isActive && { body: JSON.stringify({ isActive: true }) }),
    });
    setBreadTypes((prev) => prev.map((bt) => (bt.id === id ? breadType : bt)));
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

  if (loading) {
    return <div className="p-4 text-center opacity-50">{t('general.loading')}</div>;
  }

  return (
    <div className="p-4 space-y-6 animate-fade-in">
      <h1 className="text-xl font-bold">{t('settings.title')}</h1>

      {/* Group Name */}
      <section>
        <h2 className="font-bold mb-2">{t('settings.group_name')}</h2>
        <Card>
          <div className="flex gap-2">
            <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} className="flex-1" />
            <Button
              size="sm"
              disabled={!groupName.trim() || savingName}
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
              {savingName ? '...' : t('settings.save')}
            </Button>
          </div>
        </Card>
      </section>

      {/* Members */}
      <section>
        <h2 className="font-bold mb-2">{t('settings.members')}</h2>
        <Card>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex justify-between items-center">
                <span>{m.name}</span>
                <span className="text-sm opacity-50">{t(`role.${m.role}`)}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Invite */}
      <section>
        <h2 className="font-bold mb-2">{t('settings.invite')}</h2>
        <Card>
          <div className="flex gap-2 mb-3">
            {(['baker', 'manager'] as const).map((role) => (
              <button
                key={role}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                  inviteRole === role
                    ? 'bg-[var(--tg-theme-button-color,#3b82f6)] text-white'
                    : 'bg-black/5'
                }`}
                onClick={() => setInviteRole(role)}
              >
                {t(`role.${role}`)}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={createInvite}>{t('settings.create_invite')}</Button>
          {inviteLink && (
            <div className="mt-2 p-2 bg-black/5 rounded text-sm break-all">{inviteLink}</div>
          )}
        </Card>
      </section>

      {/* Bread Types */}
      <section>
        <h2 className="font-bold mb-2">{t('settings.bread_types')}</h2>
        <div className="space-y-2">
          {breadTypes.map((bt) =>
            editingBreadId === bt.id ? (
              <Card key={bt.id}>
                <div className="flex gap-2 mb-2">
                  <Input placeholder={t('settings.name')} value={editBreadName} onChange={(e) => setEditBreadName(e.target.value)} className="flex-1" />
                  <Input placeholder={t('settings.price')} type="number" value={editBreadPrice} onChange={(e) => setEditBreadPrice(e.target.value)} className="w-20" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveBreadType(bt.id)}>{t('settings.save')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingBreadId(null)}>{t('payments.cancel')}</Button>
                </div>
              </Card>
            ) : (
              <Card key={bt.id} className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${!bt.isActive ? 'opacity-40 line-through' : ''}`}>{bt.name}</span>
                  <span className={`opacity-60 ${!bt.isActive ? 'opacity-30' : ''}`}>₪{bt.price}</span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setEditingBreadId(bt.id); setEditBreadName(bt.name); setEditBreadPrice(bt.price); }}>
                    {t('settings.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleBreadType(bt.id, bt.isActive)}>
                    {bt.isActive ? t('settings.disable') : t('settings.enable')}
                  </Button>
                </div>
              </Card>
            )
          )}
        </div>
        <Card className="mt-2">
          <h3 className="text-sm font-medium mb-2">{t('settings.add_bread')}</h3>
          <div className="flex gap-2">
            <Input placeholder={t('settings.name')} value={newBreadName} onChange={(e) => setNewBreadName(e.target.value)} className="flex-1" />
            <Input placeholder={t('settings.price')} type="number" value={newBreadPrice} onChange={(e) => setNewBreadPrice(e.target.value)} className="w-20" />
            <Button size="sm" onClick={addBreadType}>{t('form.add')}</Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
