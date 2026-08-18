'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { friendlyError } from '@/lib/utils';
import { SectionCard } from '../SectionCard';
import { TierOverrideEditor, tierGroups, tierKey } from '../TierOverrideEditor';
import type { Tier, TypeDetailSize } from '../types';

/** Draft state keyed by (size, quantity), seeded from this bread's overrides. */
function draftFrom(sizes: TypeDetailSize[], tiers: Tier[], typeId: number) {
  const draft: Record<string, string> = {};
  for (const { size, defaults } of tierGroups(sizes, tiers)) {
    for (const d of defaults) {
      const override = tiers.find(
        (x) => x.breadSizeId === size.id && x.breadTypeId === typeId && x.minQty === d.minQty
      );
      draft[tierKey(size.id, d.minQty)] = override?.price ?? '';
    }
  }
  return draft;
}

/**
 * Per-bread bulk-price overrides. Only rendered where a size already carries
 * size-wide default tiers — an always-empty section is noise.
 *
 * Each row is its own API row, so the save walks them; there is no transaction
 * to wrap them in. It reports how many landed rather than pretending otherwise.
 */
export function TiersSection({
  typeId,
  sizes,
  tiers,
  open,
  onToggle,
  onDirtyChange,
  onSaved,
}: {
  typeId: number;
  sizes: TypeDetailSize[];
  tiers: Tier[];
  open: boolean;
  onToggle: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (tiers: Tier[]) => void;
}) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();

  const saved = useMemo(() => draftFrom(sizes, tiers, typeId), [sizes, tiers, typeId]);
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);

  // Reconcile, never replace. `saved` is rebuilt from the `sizes` prop, so
  // saving the SIZES section hands this one a fresh object — and a plain
  // setDraft(saved) would throw away everything typed here and clear the dirty
  // dot with it, so the exit guard would stop warning about work it just lost.
  // Rows that appear or disappear follow `saved`; rows already on screen keep
  // what the owner typed.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft((prev) => {
      const next: Record<string, string> = JSON.parse(savedKey);
      for (const key of Object.keys(next)) if (key in prev) next[key] = prev[key];
      return next;
    });
  }, [savedKey]);

  const dirty = useMemo(() => JSON.stringify(draft) !== savedKey, [draft, savedKey]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const groups = tierGroups(sizes, tiers);
  const PRICE = /^\d+(\.\d{1,2})?$/;
  const invalid = groups.flatMap(({ size, defaults }) =>
    defaults
      .filter((d) => {
        const raw = (draft[tierKey(size.id, d.minQty)] ?? '').trim();
        return raw !== '' && !PRICE.test(raw);
      })
      .map((d) => `${size.name} · ${d.minQty}`)
  );

  if (groups.length === 0) return null;

  async function save() {
    // An unparseable value used to be read as "inherit", which DELETED the
    // existing override. Typing 110.555 by accident would silently drop a real
    // per-bread price. Refuse the save and name the row instead.
    if (invalid.length > 0) {
      toast.error(`${t('catalog.invalid_price')}: ${invalid.join(', ')}`);
      return;
    }
    setSaving(true);
    let next = [...tiers];
    try {
      for (const { size, defaults } of groups) {
        for (const d of defaults) {
          const key = tierKey(size.id, d.minQty);
          const value = (draft[key] ?? '').trim();
          const existing = next.find(
            (x) => x.breadSizeId === size.id && x.breadTypeId === typeId && x.minQty === d.minQty
          );

          // Blank or equal to the default → inherit. Unparseable can't reach
          // here; the guard above refuses the save.
          const inherits = value === '' || Number(value) === Number(d.price);

          if (inherits) {
            if (existing) {
              await apiFetch(`/bread-size-tiers/${existing.id}`, { method: 'DELETE' });
              next = next.filter((x) => x.id !== existing.id);
            }
            continue;
          }
          if (existing?.price === value) continue;

          const { tier } = await apiFetch<{ tier: Tier }>('/bread-size-tiers', {
            method: 'POST',
            body: JSON.stringify({
              breadSizeId: size.id,
              breadTypeId: typeId,
              minQty: d.minQty,
              price: value,
            }),
          });
          next = [...next.filter((x) => x.id !== existing?.id), tier];
        }
      }
      onSaved(next);
      toast.success(t('catalog.saved'));
    } catch (e) {
      // Whatever landed before the failure is real; hand it back so the UI
      // matches the database rather than the draft.
      onSaved(next);
      toast.error(friendlyError(e, t('catalog.tier_save_failed')));
    } finally {
      setSaving(false);
    }
  }

  const overrides = Object.entries(saved).filter(([, v]) => v !== '').length;

  return (
    <SectionCard
      title={t('catalog.tier_overrides')}
      summary={
        overrides === 0
          ? t('catalog.tier_default_price')
          : `${overrides} ${t('catalog.tier_overrides_count')}`
      }
      open={open}
      onToggle={onToggle}
      dirty={dirty}
      saving={saving}
      onSave={save}
    >
      <TierOverrideEditor
        sizes={sizes}
        tiers={tiers}
        draft={draft}
        onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
        t={t}
      />
    </SectionCard>
  );
}
