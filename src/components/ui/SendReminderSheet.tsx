'use client';

import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';

type Occasion = 'week_start' | 'shabbat';

interface Props {
  count: number; // recipients shown in the confirm label
  customerIds?: number[];
  phoneId?: number;
  onClose: () => void;
  onSent?: () => void;
}

export function SendReminderSheet({ count, customerIds, phoneId, onClose, onSent }: Props) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!occasion) return;
    setSending(true);
    try {
      const res = await apiFetch<{ sent: number; failed: number; skippedOptOut: number }>('/reminders/send', {
        method: 'POST',
        body: JSON.stringify({ occasion, customerIds, phoneId }),
      });
      toast.success(
        t('reminders.sent_result')
          .replace('{sent}', String(res.sent))
          .replace('{failed}', String(res.failed))
          .replace('{skipped}', String(res.skippedOptOut))
      );
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('reminders.no_active_for_occasion'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-card p-5 space-y-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">{t('reminders.send_to')}</h3>
        <div>
          <div className="text-sm text-muted-foreground mb-1.5">{t('reminders.choose_occasion')}</div>
          <div className="flex gap-2">
            {(['week_start', 'shabbat'] as Occasion[]).map((occ) => (
              <button
                key={occ}
                type="button"
                className={
                  'flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium ' +
                  (occasion === occ
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground')
                }
                onClick={() => setOccasion(occ)}
              >
                {t(`reminders.occasion.${occ}`)}
              </button>
            ))}
          </div>
        </div>
        <Button className="w-full" disabled={!occasion} loading={sending} onClick={send}>
          {t('reminders.confirm_count').replace('{n}', String(count))}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onClose}>
          {t('reminders.cancel')}
        </Button>
      </div>
    </div>
  );
}
