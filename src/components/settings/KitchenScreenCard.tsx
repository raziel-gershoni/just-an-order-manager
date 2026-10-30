'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/hooks/useToast';
import { useT } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const clock = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });

export function KitchenScreenCard({ groupId }: { groupId: number }) {
  const { apiFetch } = useApi();
  const toast = useToast();
  const t = useT();
  const [pairing, setPairing] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [copied, setCopied] = useState(false);

  async function connect() {
    setBusy('connect');
    try {
      const { path, expiresAt } = await apiFetch<{ path: string; expiresAt: string }>(`/groups/${groupId}/kitchen`, { method: 'POST' });
      setPairing({ url: `${window.location.origin}${path}`, expiresAt });
    } catch (err) {
      console.error('[kitchen] pairing code request failed:', err);
      toast.error(t('kitchen.connect_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm(t('kitchen.disconnect_confirm'))) return;
    setBusy('disconnect');
    try {
      await apiFetch(`/groups/${groupId}/kitchen`, { method: 'DELETE' });
      setPairing(null);
      toast.success(t('kitchen.disconnected_done'));
    } catch (err) {
      console.error('[kitchen] disconnect request failed:', err);
      toast.error(t('kitchen.disconnect_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('[kitchen] copying the pairing link failed:', err);
    }
  }

  return (
    <section>
      <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">{t('kitchen.settings_title')}</h2>
      <Card>
        <p className="text-sm text-muted-foreground mb-3">{t('kitchen.settings_hint')}</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={connect} disabled={busy !== null}>{t('kitchen.connect')}</Button>
          <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy !== null}>{t('kitchen.disconnect')}</Button>
        </div>
        {pairing && (
          <div className="mt-4 flex flex-col items-center gap-3">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={pairing.url} size={208} marginSize={2} bgColor="#ffffff" fgColor="#000000" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {t('kitchen.valid_until').replace('{time}', clock.format(new Date(pairing.expiresAt)))}
            </p>
            <div className="w-full flex items-center gap-2 p-3 bg-muted rounded-lg">
              <span className="text-sm break-all flex-1 text-muted-foreground" dir="ltr">{pairing.url}</span>
              <Button size="icon" variant="ghost" onClick={copy}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
