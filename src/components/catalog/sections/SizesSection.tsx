'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { BadgePicker } from '@/components/site-editor/BadgePicker';
import { SectionCard } from '../SectionCard';
import { effectiveSizePrice, type TypeDetailSize } from '../types';

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

  const dirty = useMemo(
    () => !isBaker && JSON.stringify(draft) !== JSON.stringify(sizes),
    [draft, sizes, isBaker]
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const enabled = draft.filter((s) => s.enabled);

  function patch(sizeId: number, next: Partial<TypeDetailSize>) {
    setDraft((prev) => prev.map((s) => (s.id === sizeId ? { ...s, ...next } : s)));
  }

  function toggle(sizeId: number) {
    setDraft((prev) =>
      prev.map((s) =>
        s.id === sizeId
          ? { ...s, enabled: !s.enabled, priceOverride: s.enabled ? null : s.priceOverride }
          : s
      )
    );
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/groups/${groupId}/bread-types/${typeId}/sizes`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: enabled.map((s) => ({
            breadSizeId: s.id,
            // Storing an override equal to the default would be a lie the
            // pricelist then has to keep telling.
            priceOverride:
              s.priceOverride && s.priceOverride !== s.price ? s.priceOverride : null,
            badgeType: s.badgeType,
            badgeLabel: s.badgeType === 'custom' ? s.badgeLabel?.trim() || null : null,
            badgeIcon: s.badgeIcon,
          })),
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

  const prices = enabled.map((s) => Number(effectiveSizePrice(s)));
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
                      {s.weightGrams != null && (
                        <span dir="ltr" className="tabular-nums text-muted-foreground">
                          {' '}
                          · {s.weightGrams}g
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
