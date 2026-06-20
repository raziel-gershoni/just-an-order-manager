'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT, useLang } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { Copy, Check, ChevronRight, ChevronLeft, ChefHat, Upload, Trash2 } from 'lucide-react';
import { ControlCenterTabs } from '@/components/ui/ControlCenterTabs';
import { getInitial } from '@/lib/name-utils';
import Link from 'next/link';

interface Member { id: number; userId: number; name: string; role: string }
interface Invite { id: number; inviteCode: string; role: string; status: string }

export default function SettingsPage() {
  const { apiFetch, apiUpload } = useApi();
  const { activeGroupId } = useGroup();
  const t = useT();
  const lang = useLang();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const [groupName, setGroupName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const canManage = role === 'owner' || role === 'manager';

  const [inviteRole, setInviteRole] = useState<'manager' | 'baker'>('baker');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;

  useEffect(() => {
    if (!activeGroupId) return;
    Promise.all([
      apiFetch<{ group: { name: string; logoUrl: string | null }; role: string }>(`/groups/${activeGroupId}`),
      apiFetch<{ members: Member[] }>(`/groups/${activeGroupId}/members`),
      apiFetch<{ invites: Invite[] }>(`/groups/${activeGroupId}/invites`),
    ])
      .then(([g, m, i]) => {
        setGroupName(g.group.name);
        setLogoUrl(g.group.logoUrl ?? null);
        setRole(g.role);
        setMembers(m.members);
        setInvites(i.invites);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeGroupId]);

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeGroupId) return;
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { logoUrl: url } = await apiUpload<{ logoUrl: string }>(
        `/groups/${activeGroupId}/logo`,
        fd
      );
      setLogoUrl(url);
    } catch {}
    setUploadingLogo(false);
  }

  async function removeLogo() {
    if (!activeGroupId) return;
    setLogoUrl(null);
    try {
      await apiFetch(`/groups/${activeGroupId}/logo`, { method: 'DELETE' });
    } catch {}
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
    <>
      <ControlCenterTabs />
      <div className="p-5 space-y-6 animate-fade-in">

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

      {/* Bakery logo */}
      <section>
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">
          {t('settings.logo')}
        </h2>
        <Card>
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-full border border-border bg-muted">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl">🌾</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{t('settings.logo_hint')}</p>
              {canManage && (
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" loading={uploadingLogo} onClick={() => logoRef.current?.click()}>
                    <Upload className="h-4 w-4" />
                    {t('settings.logo_upload')}
                  </Button>
                  {logoUrl && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={removeLogo}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <input ref={logoRef} type="file" accept="image/*" hidden onChange={onPickLogo} />
                </div>
              )}
            </div>
          </div>
        </Card>
      </section>

      {/* Baker page link */}
      <section>
        <Link href="/miniapp/baker">
          <Card className="flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <ChefHat className="h-4 w-4" />
              </div>
              <div>
                <div className="font-medium">{t('baker.title')}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('baker.recipe_block_title')}
                </div>
              </div>
            </div>
            <Chevron className="h-4 w-4 text-muted-foreground/40" />
          </Card>
        </Link>
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
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          )}
          {invites.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">הזמנות ממתינות</div>
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{t(`role.${inv.role}`)}</span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {inv.status === 'pending' ? 'ממתין' : inv.status === 'accepted' ? 'התקבל' : inv.status === 'declined' ? 'נדחה' : 'פג'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
      </div>
    </>
  );
}
