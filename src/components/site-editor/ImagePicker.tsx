'use client';

import { useState } from 'react';
import { useT } from '@/hooks/useLang';
import type { MediaAsset } from './MediaLibrary';
import { ImagePlus, X } from 'lucide-react';

/** Pick one image from the shared library (or clear it). Stateless on the
 *  data — the parent owns `value` and the `assets` list. */
export function ImagePicker({
  value,
  assets,
  onChange,
}: {
  value: number | null;
  assets: MediaAsset[];
  onChange: (id: number | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = assets.find((a) => a.id === value) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
      >
        {current ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.blobUrl} alt="" className="h-8 w-8 rounded object-cover" />
            <span className="text-muted-foreground">{t('site.image_field')}</span>
          </>
        ) : (
          <>
            <ImagePlus className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('site.image_none')}</span>
          </>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background/95 p-5" onClick={() => setOpen(false)}>
          <div
            className="mx-auto flex w-full max-w-md flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">{t('site.image_pick')}</span>
              <div className="flex items-center gap-3">
                <button type="button" className="text-sm text-destructive" onClick={() => { onChange(null); setOpen(false); }}>
                  {t('site.image_none')}
                </button>
                <button type="button" aria-label="close" onClick={() => setOpen(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {assets.length === 0 ? (
              <p className="py-6 text-center text-xs italic text-muted-foreground">{t('site.media_empty')}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 overflow-y-auto">
                {assets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => { onChange(a.id); setOpen(false); }}
                    className={
                      'overflow-hidden rounded-lg border-2 ' +
                      (a.id === value ? 'border-primary' : 'border-border')
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.blobUrl} alt={a.alt ?? ''} className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
