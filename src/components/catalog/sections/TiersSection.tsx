'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { friendlyError } from '@/lib/utils';
import { SectionCard } from '../SectionCard';
import {
  TierOverrideEditor,
  TIER_PRICE,
  canonicalTierPrice,
  tierGroups,
  tierKey,
} from '../TierOverrideEditor';
import type { Tier, TypeDetailSize } from '../types';

type TierGroups = ReturnType<typeof tierGroups>;

/** Draft state keyed by (size, quantity), seeded from this bread's overrides. */
function draftFrom(groups: TierGroups, tiers: Tier[], typeId: number) {
  const draft: Record<string, string> = {};
  for (const { size, defaults } of groups) {
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

  const groups = useMemo(() => tierGroups(sizes, tiers), [sizes, tiers]);
  const saved = useMemo(() => draftFrom(groups, tiers, typeId), [groups, tiers, typeId]);
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

  // Dirty means "the database does not hold this", not "the text differs".
  // Both sides go through canonicalTierPrice: a typed 9 and a stored 9.00 are
  // the same row, and so are a typed default and no row at all. Comparing the
  // raw strings left the section dirty forever after a successful save, because
  // numeric(10,2) never hands back the text that was typed into it.
  const dirty = useMemo(
    () =>
      groups.some(({ size, defaults }) =>
        defaults.some((d) => {
          const key = tierKey(size.id, d.minQty);
          return (
            canonicalTierPrice(draft[key] ?? '', d.price) !==
            canonicalTierPrice(saved[key] ?? '', d.price)
          );
        })
      ),
    [groups, draft, saved]
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const invalid = groups.flatMap(({ size, defaults }) =>
    defaults
      .filter((d) => {
        const raw = (draft[tierKey(size.id, d.minQty)] ?? '').trim();
        return raw !== '' && !TIER_PRICE.test(raw);
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
          // The row as the database would hold it: '' inherits the default, and
          // anything else is already in the two-decimal form the column returns,
          // so what comes back matches what is on screen.
          const price = canonicalTierPrice(draft[key] ?? '', d.price);
          const existing = next.find(
            (x) => x.breadSizeId === size.id && x.breadTypeId === typeId && x.minQty === d.minQty
          );

          if (price === '') {
            if (existing) {
              await apiFetch(`/bread-size-tiers/${existing.id}`, { method: 'DELETE' });
              next = next.filter((x) => x.id !== existing.id);
            }
            continue;
          }
          // Already stored, whatever it was typed as — no write, no new row id.
          if (existing && canonicalTierPrice(existing.price, d.price) === price) continue;

          const { tier } = await apiFetch<{ tier: Tier }>('/bread-size-tiers', {
            method: 'POST',
            body: JSON.stringify({
              breadSizeId: size.id,
              breadTypeId: typeId,
              minQty: d.minQty,
              price,
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

  // Counted by the same rule the dot and the row highlight use, so a stored row
  // that merely matches its default is not advertised as an override.
  const overrides = groups.reduce(
    (n, { size, defaults }) =>
      n +
      defaults.filter(
        (d) => canonicalTierPrice(saved[tierKey(size.id, d.minQty)] ?? '', d.price) !== ''
      ).length,
    0
  );

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
