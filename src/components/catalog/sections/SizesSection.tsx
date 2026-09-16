'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { BadgePicker } from '@/components/site-editor/BadgePicker';
import { friendlyError } from '@/lib/utils';
import { SectionCard } from '../SectionCard';
import { PRICE_INPUT, canonicalOverridePrice, effectivePrice } from '@/lib/pricing';
import type { TypeDetailSize } from '../types';

/**
 * The rows as this section's PUT leaves them in the database.
 *
 * The endpoint is clean-slate and is only sent the enabled sizes, so a disabled
 * size ends up with no row at all — no override, no badge — while an enabled one
 * carries a canonical override (numeric(10,2), and nothing at all when it merely
 * repeats the size's own price) and a trimmed custom label.
 *
 * Both the payload and the new baseline are built from this, and the dirty check
 * runs it over both sides. Handing the raw draft back as the baseline used to
 * clear the dot while the sheet — and the bread's row in the catalog list, which
 * is fed the same object — went on showing a per-bread price that
 * bread_type_sizes never held; raise that size's price later and the bread moved
 * with it, against what the screen had promised.
 */
function stored(rows: TypeDetailSize[]): TypeDetailSize[] {
  return rows.map((s) => {
    if (!s.enabled) {
      return { ...s, priceOverride: null, badgeType: null, badgeLabel: null, badgeIcon: null };
    }
    const override = canonicalOverridePrice(s.priceOverride ?? '', s.price);
    return {
      ...s,
      priceOverride: override === '' ? null : override,
      badgeLabel: s.badgeType === 'custom' ? s.badgeLabel?.trim() || null : null,
    };
  });
}

/**
 * Which sizes this bread comes in, what each costs, and the public-site badge
 * on each — one section because they are one endpoint. The sizes PUT is
 * clean-slate (it deletes every junction row and re-inserts), so splitting the
 * badges into their own section would mean two writers racing over one row.
 */
export function SizesSection({
  typeId,
  groupId,
  sizes,
  isBaker,
  open,
  onToggle,
  onDirtyChange,
  onSaved,
}: {
  typeId: number;
  groupId: number;
  sizes: TypeDetailSize[];
  isBaker: boolean;
  open: boolean;
  onToggle: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (sizes: TypeDetailSize[]) => void;
}) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();

  const [draft, setDraft] = useState<TypeDetailSize[]>(sizes);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(sizes), [sizes]);

  // Dirty means "saving would change the row": what the save would store,
  // against what the server actually holds. A typed 30 against a size priced
  // 30.00 is not an override and a typed 9 is the 9.00 already stored, so
  // neither lights up — but a stored override that merely repeats the base
  // price is still a real row, and clearing it has to remain saveable.
  const target = useMemo(() => stored(draft), [draft]);
  const dirty = useMemo(
    () => !isBaker && JSON.stringify(target) !== JSON.stringify(sizes),
    [target, sizes, isBaker]
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const enabled = draft.filter((s) => s.enabled);
  const invalid = enabled.filter((s) => {
    const raw = s.priceOverride?.trim();
    return !!raw && !PRICE_INPUT.test(raw);
  });

  function patch(sizeId: number, next: Partial<TypeDetailSize>) {
    setDraft((prev) => prev.map((s) => (s.id === sizeId ? { ...s, ...next } : s)));
  }

  function toggle(sizeId: number) {
    // The override is kept in the draft rather than nulled, because an
    // accidental off-then-on tap used to silently drop a real per-bread price.
    // It survives only until the next save: the PUT is clean slate, so stored()
    // clears it along with the row the endpoint deletes.
    setDraft((prev) =>
      prev.map((s) => (s.id === sizeId ? { ...s, enabled: !s.enabled } : s))
    );
  }

  async function save() {
    // The endpoint rejects a malformed price with a raw zod message and drops
    // the whole payload — including this section's other edits. Catch it here
    // and name the size instead.
    if (invalid.length > 0) {
      toast.error(`${t('catalog.invalid_price')}: ${invalid.map((s) => s.name).join(', ')}`);
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/groups/${groupId}/bread-types/${typeId}/sizes`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: target
            .filter((s) => s.enabled)
            .map((s) => ({
              breadSizeId: s.id,
              priceOverride: s.priceOverride,
              badgeType: s.badgeType,
              badgeLabel: s.badgeLabel,
              badgeIcon: s.badgeIcon,
            })),
        }),
      });
      // The stored shape, never the draft: what the boxes show now is what a
      // reopen of this sheet would load.
      onSaved(target);
      toast.success(t('catalog.saved'));
    } catch (e) {
      toast.error(friendlyError(e, t('catalog.save_failed')));
    } finally {
      setSaving(false);
    }
  }

  const prices = enabled.map((s) => Number(effectivePrice(s)));
  const summary =
    enabled.length === 0
      ? t('settings.no_enabled_sizes')
      : `${enabled.length} ${t('settings.enabled_sizes_count')} · ₪${Math.min(...prices)}–${Math.max(...prices)}`;

  return (
    <SectionCard
      title={t('catalog.section_sizes')}
      summary={summary}
      open={open}
      onToggle={onToggle}
      dirty={dirty}
      saving={saving}
      onSave={isBaker ? undefined : save}
    >
      {isBaker ? (
        <div className="flex flex-wrap gap-2">
          {enabled.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm"
            >
              {s.name}
              {s.weightGrams != null && (
                <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                  {s.weightGrams}g
                </span>
              )}
              {/* The old overlay showed bakers the price here on purpose. */}
              <span dir="ltr" className="font-mono text-xs tabular-nums text-muted-foreground">
                · ₪{effectivePrice(s)}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {draft.map((s) =>
              s.enabled ? (
                <div
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/15 px-3 py-1.5 text-sm font-medium"
                >
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    className="inline-flex items-center gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>
                      {s.name}
                      {s.weightGrams != null && (
                        <span dir="ltr" className="ms-0.5 text-xs tabular-nums text-muted-foreground">
                          {s.weightGrams}g
                        </span>
                      )}
                    </span>
                  </button>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="inline-flex items-center font-mono text-xs text-muted-foreground">
                    ₪
                    <input
                      type="number"
                      inputMode="decimal"
                      value={s.priceOverride ?? ''}
                      placeholder={s.price}
                      onChange={(e) => patch(s.id, { priceOverride: e.target.value || null })}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${t('settings.price')} · ${s.name}`}
                      className="w-12 bg-transparent text-center tabular-nums text-foreground placeholder:text-muted-foreground/50 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </span>
                </div>
              ) : (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/40"
                >
                  <span>
                    {s.name}
                    {s.weightGrams != null && (
                      <span dir="ltr" className="ms-0.5 text-xs tabular-nums">
                        {s.weightGrams}g
                      </span>
                    )}
                  </span>
                  <span dir="ltr" className="font-mono text-xs tabular-nums">
                    · ₪{s.price}
                  </span>
                </button>
              )
            )}
          </div>

          {enabled.length === 0 && (
            <p className="py-2 text-xs italic text-muted-foreground">
              {t('settings.no_enabled_sizes')}
            </p>
          )}

          {/* Per-size badges live here rather than in מיתוג: they are written by
              this section's endpoint. Nested, so the pickers don't stack up in
              the sheet's main scroll. */}
          {enabled.length > 0 && (
            <details className="rounded-md border border-dashed border-border px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                {t('site.size_badges')}
              </summary>
              <div className="space-y-3 pt-3">
                {enabled.map((s) => (
                  <div key={s.id} className="space-y-1.5">
                    <div className="text-xs font-semibold">
                      {s.name}
                      {/* Separator and space outside the isolate, digits
                          inside it: with the whole phrase isolated, the space
                          and the "·" were carried to the isolate's far edge —
                          "גדול700g ·", the weight welded to the name and the
                          dot stranded past it. */}
                      {s.weightGrams != null && (
                        <span className="text-muted-foreground">
                          {' · '}
                          <span dir="ltr" className="tabular-nums">
                            {s.weightGrams}g
                          </span>
                        </span>
                      )}
                    </div>
                    <BadgePicker
                      badgeType={s.badgeType}
                      badgeLabel={s.badgeLabel}
                      badgeIcon={s.badgeIcon}
                      onChange={(type, label, icon) =>
                        patch(s.id, { badgeType: type, badgeLabel: label, badgeIcon: icon })
                      }
                    />
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </SectionCard>
  );
}
