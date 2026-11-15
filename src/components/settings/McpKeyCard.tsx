'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/hooks/useToast';
import { useT } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { israelDateStr } from '@/lib/date-utils';

// dd.MM.yyyy on the bakery's calendar day, whatever the phone's zone is.
const shortDate = (iso: string) => israelDateStr(new Date(iso)).split('-').reverse().join('.');

// The AI bot's key. Owner only (the page renders it for owners alone). The key
// is returned once, held in state only, and gone when the card unmounts.
export function McpKeyCard({ groupId, initialCreatedAt }: { groupId: number; initialCreatedAt: string | null }) {
  const { apiFetch } = useApi();
  const toast = useToast();
  const t = useT();
  const [createdAt, setCreatedAt] = useState<string | null>(initialCreatedAt);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'disconnect' | null>(null);
  const [copied, setCopied] = useState<'address' | 'key' | null>(null);
  const address = `${typeof window === 'undefined' ? '' : window.location.origin}/api/mcp`;

  async function create() {
    if (createdAt && !window.confirm(t('mcp.replace_confirm'))) return;
    setBusy('create');
    try {
      const res = await apiFetch<{ key: string; createdAt: string }>(`/groups/${groupId}/mcp-key`, { method: 'POST' });
      setNewKey(res.key);
      setCreatedAt(res.createdAt);
    } catch (err) {
      console.error('[mcp-key] create request failed:', err);
      toast.error(t('mcp.create_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm(t('mcp.disconnect_confirm'))) return;
    setBusy('disconnect');
    try {
      await apiFetch(`/groups/${groupId}/mcp-key`, { method: 'DELETE' });
      setNewKey(null);
      setCreatedAt(null);
      toast.success(t('mcp.disconnected_done'));
    } catch (err) {
      console.error('[mcp-key] disconnect request failed:', err);
      toast.error(t('mcp.disconnect_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function copy(what: 'address' | 'key', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    } catch (err) {
      console.warn(`[mcp-key] copying the ${what} failed:`, err);
    }
  }

  const copyIcon = (what: 'address' | 'key') =>
    copied === what ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />;

  return (
    <section>
      <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">{t('mcp.settings_title')}</h2>
      <Card>
        <p className="text-sm text-muted-foreground mb-3">{t('mcp.settings_hint')}</p>
        <p className="text-sm font-medium mb-3">
          {createdAt ? t('mcp.connected_since').replace('{date}', shortDate(createdAt)) : t('mcp.not_connected')}
        </p>
        <div className="text-xs text-muted-foreground mb-1">{t('mcp.address')}</div>
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg mb-3">
          <span className="text-sm break-all flex-1 text-muted-foreground" dir="ltr">{address}</span>
          <Button size="icon" variant="ghost" onClick={() => copy('address', address)}>{copyIcon('address')}</Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={create} disabled={busy !== null}>{createdAt ? t('mcp.replace') : t('mcp.create')}</Button>
          {createdAt && (
            <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy !== null}>{t('mcp.disconnect')}</Button>
          )}
        </div>
        {newKey && (
          <div className="mt-4">
            <p className="text-sm font-medium text-destructive mb-2">{t('mcp.key_once')}</p>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <span className="text-sm break-all flex-1" dir="ltr">{newKey}</span>
              <Button size="icon" variant="ghost" onClick={() => copy('key', newKey)}>{copyIcon('key')}</Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
