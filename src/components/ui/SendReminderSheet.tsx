'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Upload, X, ImageOff } from 'lucide-react';
import type { MediaAsset } from '@/components/site-editor/MediaLibrary';

type Occasion = 'week_start' | 'shabbat';

interface Props {
  count: number; // recipients shown in the confirm label
  customerIds?: number[];
  phoneId?: number;
  onClose: () => void;
  onSent?: () => void;
}

function measure(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function SendReminderSheet({ count, customerIds, phoneId, onClose, onSent }: Props) {
  const { apiFetch, apiUpload } = useApi();
  const t = useT();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [sending, setSending] = useState(false);

  // Header image (for IMAGE-header templates) — chosen per send.
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [mediaId, setMediaId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    apiFetch<{ assets: MediaAsset[] }>('/media')
      .then((r) => setAssets(r.assets))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const { width, height } = await measure(file);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('width', String(width));
      fd.append('height', String(height));
      const { asset } = await apiUpload<{ asset: MediaAsset }>('/media', fd);
      setAssets((p) => [...p, asset]);
      setMediaId(asset.id);
    } catch {
      toast.error(t('site.save_failed'));
    } finally {
      setUploading(false);
    }
  }

  async function removeAsset(a: MediaAsset) {
    setAssets((p) => p.filter((x) => x.id !== a.id));
    if (mediaId === a.id) setMediaId(null);
    try {
      await apiFetch(`/media/${a.id}`, { method: 'DELETE' });
    } catch {
      toast.error(t('site.save_failed'));
    }
  }

  async function send() {
    if (!occasion) return;
    setSending(true);
    try {
      const res = await apiFetch<{ sent: number; failed: number; skippedOptOut: number }>('/reminders/send', {
        method: 'POST',
        body: JSON.stringify({ occasion, customerIds, phoneId, mediaId: mediaId ?? undefined }),
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

  const tile = 'relative h-16 w-16 flex-none overflow-hidden rounded-lg border';

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

        {/* Header image — supplied on every send for IMAGE-header templates. */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            {t('reminders.header_image')}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {t('reminders.image_optional')}
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {/* none */}
            <button
              type="button"
              onClick={() => setMediaId(null)}
              className={
                tile +
                ' grid place-items-center text-muted-foreground ' +
                (mediaId === null ? 'border-primary ring-2 ring-primary' : 'border-border')
              }
            >
              <ImageOff className="h-5 w-5" />
              <span className="absolute bottom-1 text-[9px] font-medium">{t('reminders.no_image')}</span>
            </button>

            {assets.map((a) => (
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                onClick={() => setMediaId(a.id)}
                className={
                  tile +
                  ' cursor-pointer ' +
                  (mediaId === a.id ? 'border-primary ring-2 ring-primary' : 'border-border')
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.blobUrl} alt={a.alt ?? ''} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAsset(a);
                  }}
                  className="absolute start-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            {/* upload */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={tile + ' grid place-items-center border-dashed border-border text-muted-foreground disabled:opacity-50'}
            >
              <Upload className="h-5 w-5" />
              <span className="absolute bottom-1 text-[9px] font-medium">{t('reminders.upload_image')}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
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
