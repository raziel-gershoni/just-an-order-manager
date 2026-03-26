'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

interface InviteInfo { groupName: string; role: string; status: string }

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const { apiFetch } = useApi();
  const router = useRouter();
  const t = useT();
  const toast = useToast();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    apiFetch<{ invite: InviteInfo }>(`/invites/${code}`)
      .then((d) => setInvite(d.invite))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [code]);

  async function respond(action: 'accept' | 'decline') {
    setActing(true);
    try {
      await apiFetch(`/invites/${code}`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      router.push('/miniapp');
    } catch {
      toast.error(t('join.failed'));
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('join.title')} />
        <div className="p-4 text-center opacity-50">{t('general.loading')}</div>
      </>
    );
  }

  if (!invite || invite.status !== 'pending') {
    return (
      <>
        <PageHeader title={t('join.title')} />
        <div className="p-4 text-center">{t('join.invalid')}</div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('join.title')} />
      <div className="p-4 space-y-4 animate-fade-in">
        <Card className="text-center">
          <p className="text-lg mb-2">
            {t('join.join_group')} <strong>{invite.groupName}</strong>
          </p>
          <p className="opacity-60">{t('join.as_role')} {t(`role.${invite.role}`)}</p>
        </Card>

        <div className="flex gap-3">
          <Button className="flex-1" disabled={acting} onClick={() => respond('accept')}>
            {acting ? '...' : t('join.accept')}
          </Button>
          <Button variant="secondary" className="flex-1" disabled={acting} onClick={() => respond('decline')}>
            {t('join.decline')}
          </Button>
        </div>
      </div>
    </>
  );
}
