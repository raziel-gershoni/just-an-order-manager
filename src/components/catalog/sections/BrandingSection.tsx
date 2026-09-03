'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { BadgePicker } from '@/components/site-editor/BadgePicker';
import { ImagePicker } from '@/components/site-editor/ImagePicker';
import type { MediaAsset } from '@/components/site-editor/MediaLibrary';
import { friendlyError } from '@/lib/utils';
import { SectionCard } from '../SectionCard';

export interface Branding {
  badgeType: string | null;
  badgeLabel: string | null;
  badgeIcon: string | null;
  imageId: number | null;
}

/**
 * What the PATCH stores for a branding draft: the custom label is trimmed, and
 * a label belongs to nothing but the custom badge.
 *
 * Used on both sides of the dirty check and as the payload. The badge picker
 * hands back '' where the row holds null, so tapping the already-selected custom
 * chip used to raise a שמור for a change nobody made; and a label typed with a
 * stray space used to sit in the box looking saved while the row held the
 * trimmed one.
 */
function stored(b: Branding) {
  return {
    badgeType: b.badgeType,
    badgeLabel: b.badgeType === 'custom' ? b.badgeLabel?.trim() || null : null,
    badgeIcon: b.badgeIcon,
    imageId: b.imageId,
  };
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
    () => JSON.stringify(stored(draft)) !== JSON.stringify(stored(branding)),
    [draft, branding]
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function save() {
    setSaving(true);
    try {
      // The route returns the updated row, so the baseline is what was stored
      // rather than what was typed.
      const { breadType } = await apiFetch<{ breadType: Branding }>(`/bread-types/${typeId}`, {
        method: 'PATCH',
        body: JSON.stringify(stored(draft)),
      });
      onSaved({
        badgeType: breadType.badgeType,
        badgeLabel: breadType.badgeLabel,
        badgeIcon: breadType.badgeIcon,
        imageId: breadType.imageId,
      });
      toast.success(t('catalog.saved'));
    } catch (e) {
      toast.error(friendlyError(e, t('catalog.save_failed')));
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
