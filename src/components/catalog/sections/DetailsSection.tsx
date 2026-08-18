'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Input } from '@/components/ui/Input';
import { friendlyError } from '@/lib/utils';
import { SectionCard } from '../SectionCard';

/** The bread's name. One field, one PATCH. */
export function DetailsSection({
  typeId,
  name,
  isBaker,
  open,
  onToggle,
  onDirtyChange,
  onSaved,
}: {
  typeId: number;
  name: string;
  isBaker: boolean;
  open: boolean;
  onToggle: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (name: string) => void;
}) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();

  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(name), [name, typeId]);

  const dirty = !isBaker && draft.trim() !== '' && draft.trim() !== name;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function save() {
    setSaving(true);
    try {
      const { breadType } = await apiFetch<{ breadType: { name: string } }>(
        `/bread-types/${typeId}`,
        { method: 'PATCH', body: JSON.stringify({ name: draft.trim() }) }
      );
      onSaved(breadType.name);
      toast.success(t('catalog.saved'));
    } catch (e) {
      toast.error(friendlyError(e, t('catalog.save_failed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title={t('catalog.section_details')}
      summary={name}
      open={open}
      onToggle={onToggle}
      dirty={dirty}
      saving={saving}
      onSave={isBaker ? undefined : save}
    >
      {isBaker ? (
        <div className="text-base font-semibold">{name}</div>
      ) : (
        <Input
          label={t('settings.name')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
    </SectionCard>
  );
}
