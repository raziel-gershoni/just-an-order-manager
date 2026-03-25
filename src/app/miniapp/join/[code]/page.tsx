'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface InviteInfo {
  groupName: string;
  role: string;
  status: string;
}

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const { apiFetch } = useApi();
  const router = useRouter();
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
      alert('Failed to respond to invite');
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return <div className="p-4 text-center opacity-50">Loading...</div>;
  }

  if (!invite || invite.status !== 'pending') {
    return (
      <div className="p-4 text-center">
        <p>This invite is no longer valid.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold text-center">Group Invite</h1>

      <Card className="text-center">
        <p className="text-lg mb-2">
          Join <strong>{invite.groupName}</strong>
        </p>
        <p className="opacity-60 capitalize">as {invite.role}</p>
      </Card>

      <div className="flex gap-3">
        <Button
          className="flex-1"
          disabled={acting}
          onClick={() => respond('accept')}
        >
          {acting ? '...' : 'Accept'}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={acting}
          onClick={() => respond('decline')}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
