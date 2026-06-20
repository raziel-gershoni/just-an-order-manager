'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Star, Images, Trash2, Upload } from 'lucide-react';

export interface MediaAsset {
  id: number;
  blobUrl: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  showInGallery: boolean;
  sortOrder: number;
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

export function MediaLibrary({
  heroImageId,
  onSetHero,
}: {
  heroImageId: number | null;
  onSetHero: (id: number | null) => void;
}) {
  const { apiFetch, apiUpload } = useApi();
  const t = useT();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<MediaAsset[]>([]);
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
    } catch {
      toast.error(t('site.save_failed'));
    } finally {
      setUploading(false);
    }
  }

  async function toggleGallery(a: MediaAsset) {
    const next = !a.showInGallery;
    setAssets((p) => p.map((x) => (x.id === a.id ? { ...x, showInGallery: next } : x)));
    try {
      await apiFetch(`/media/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ showInGallery: next }),
      });
    } catch {
      setAssets((p) => p.map((x) => (x.id === a.id ? { ...x, showInGallery: !next } : x)));
    }
  }

  async function remove(a: MediaAsset) {
    setAssets((p) => p.filter((x) => x.id !== a.id));
    if (heroImageId === a.id) onSetHero(null);
    try {
      await apiFetch(`/media/${a.id}`, { method: 'DELETE' });
    } catch {
      toast.error(t('site.save_failed'));
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground">{t('site.media_title')}</span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {uploading ? t('site.media_uploading') : t('site.media_upload')}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
      </div>

      {assets.length === 0 ? (
        <p className="py-6 text-center text-xs italic text-muted-foreground">{t('site.media_empty')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {assets.map((a) => {
            const isHero = heroImageId === a.id;
            return (
              <div key={a.id} className="overflow-hidden rounded-lg border border-border bg-muted">
                <div className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.blobUrl} alt={a.alt ?? ''} className="h-full w-full object-cover" />
                  {isHero && (
                    <span className="absolute start-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                      {t('site.media_is_hero')}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-around py-1.5">
                  <button
                    type="button"
                    aria-label="hero"
                    title={t('site.media_set_hero')}
                    onClick={() => onSetHero(isHero ? null : a.id)}
                    className={isHero ? 'text-primary' : 'text-muted-foreground'}
                  >
                    <Star className="h-4 w-4" fill={isHero ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    aria-label="gallery"
                    title={t('site.media_in_gallery')}
                    onClick={() => toggleGallery(a)}
                    className={a.showInGallery ? 'text-success' : 'text-muted-foreground'}
                  >
                    <Images className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="delete"
                    onClick={() => remove(a)}
                    className="text-destructive/70 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
