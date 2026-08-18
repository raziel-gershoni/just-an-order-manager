'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { BadgePicker } from '@/components/site-editor/BadgePicker';
import { ImagePicker } from '@/components/site-editor/ImagePicker';
import type { MediaAsset } from '@/components/site-editor/MediaLibrary';
import { SectionCard } from '../SectionCard';

export interface Branding {
  badgeType: string | null;
  badgeLabel: string | null;
  badgeIcon: string | null;
  imageId: number | null;
}

/** How this bread appears on the public site: one badge and one photo. */
export function BrandingSection({
  typeId,
  branding,
  assets,
  open,
  onToggle,
  onDirtyChange,
  onSaved,
}: {
  typeId: number;
  branding: Branding;
  assets: MediaAsset[];
  open: boolean;
  onToggle: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (branding: Branding) => void;
}) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();

  const [draft, setDraft] = useState<Branding>(branding);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(branding), [branding]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(branding),
    [draft, branding]
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/bread-types/${typeId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          badgeType: draft.badgeType,
          badgeLabel: draft.badgeType === 'custom' ? draft.badgeLabel?.trim() || null : null,
          badgeIcon: draft.badgeIcon,
          imageId: draft.imageId,
        }),
      });
      onSaved(draft);
      toast.success(t('catalog.saved'));
    } catch (e) {
      toast.error((e as Error).message || t('catalog.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  const marks = [
    draft.badgeType ? t('catalog.branding_badge') : null,
    draft.imageId ? t('catalog.branding_image') : null,
  ].filter(Boolean);

  return (
    <SectionCard
      title={t('site.type_branding')}
      summary={marks.length > 0 ? marks.join(' · ') : t('catalog.none')}
      open={open}
      onToggle={onToggle}
      dirty={dirty}
      saving={saving}
      onSave={save}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{t('site.type_image')}</span>
        <ImagePicker
          value={draft.imageId}
          assets={assets}
          onChange={(imageId) => setDraft((d) => ({ ...d, imageId }))}
        />
      </div>
      <BadgePicker
        badgeType={draft.badgeType}
        badgeLabel={draft.badgeLabel}
        badgeIcon={draft.badgeIcon}
        onChange={(badgeType, badgeLabel, badgeIcon) =>
          setDraft((d) => ({ ...d, badgeType, badgeLabel, badgeIcon }))
        }
      />
    </SectionCard>
  );
}
