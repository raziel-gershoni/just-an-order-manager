'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { cn, friendlyError } from '@/lib/utils';
import { SectionCard } from '../SectionCard';
import type { TypeDetailAddition } from '../types';

/** Which additions this bread can carry. */
export function AdditionsSection({
  typeId,
  groupId,
  additions,
  isBaker,
  open,
  onToggle,
  onDirtyChange,
  onSaved,
}: {
  typeId: number;
  groupId: number;
  additions: TypeDetailAddition[];
  isBaker: boolean;
  open: boolean;
  onToggle: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (additions: TypeDetailAddition[]) => void;
}) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();

  const [draft, setDraft] = useState<TypeDetailAddition[]>(additions);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(additions), [additions]);

  const dirty = useMemo(
    () => !isBaker && JSON.stringify(draft) !== JSON.stringify(additions),
    [draft, additions, isBaker]
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const enabled = draft.filter((a) => a.enabled);

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/groups/${groupId}/bread-types/${typeId}/additions`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: enabled.map((a) => a.id) }),
      });
      onSaved(draft);
      toast.success(t('catalog.saved'));
    } catch (e) {
      toast.error(friendlyError(e, t('catalog.save_failed')));
    } finally {
      setSaving(false);
    }
  }

  if (additions.length === 0) return null;

  return (
    <SectionCard
      title={t('settings.enabled_additions')}
      summary={
        enabled.length === 0
          ? t('catalog.none')
          : enabled
              .slice(0, 4)
              .map((a) => a.name)
              .join(', ') + (enabled.length > 4 ? ` +${enabled.length - 4}` : '')
      }
      open={open}
      onToggle={onToggle}
      dirty={dirty}
      saving={saving}
      onSave={isBaker ? undefined : save}
    >
      <div className="flex flex-wrap gap-2">
        {(isBaker ? enabled : draft).map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={isBaker}
            onClick={() =>
              setDraft((prev) =>
                prev.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x))
              )
            }
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
              a.enabled
                ? 'border-primary/50 bg-primary/15 font-medium text-foreground'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40'
            )}
          >
            {a.enabled && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            <span>{a.name}</span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}
