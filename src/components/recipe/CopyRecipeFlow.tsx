'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useT } from '@/hooks/useLang';
import { IngredientNameInput } from './IngredientNameInput';
import { groupByKind, type IngredientKind } from '@/lib/recipe';
import type { GroupRecipe, NamesByKind, SeedRow } from './types';

interface FlourRow {
  name: string;
  pctOfFinished: number;
  pctOfFlour: number;
}

/**
 * The two steps between "copy from" and the editor: pick a source, then say
 * which flour this bread uses.
 *
 * It writes nothing. It hands back seed rows and the editor stays the only
 * thing that saves, so backing out at any point leaves no half-made recipe
 * behind.
 */
export function CopyRecipeFlow({
  sources,
  namesByKind,
  onCancel,
  onDone,
}: {
  sources: GroupRecipe[];
  namesByKind: NamesByKind;
  onCancel: () => void;
  onDone: (rows: SeedRow[]) => void;
}) {
  const t = useT();
  const [source, setSource] = useState<GroupRecipe | null>(null);
  const [flours, setFlours] = useState<FlourRow[]>([]);
  const [original, setOriginal] = useState<FlourRow[]>([]);
  const [merged, setMerged] = useState(false);

  function pick(s: GroupRecipe) {
    const f = s.ingredients
      .filter((i) => i.kind === 'flour')
      .map((i) => ({ name: i.name, pctOfFinished: i.pctOfFinished, pctOfFlour: i.pctOfFlour }));
    setSource(s);
    setFlours(f);
    setOriginal(f);
    setMerged(false);
  }

  function mergeFlours() {
    // Sum, don't average: a variation that swaps a 50/50 blend for one flour
    // uses the same total flour, so the dough must not change weight.
    setFlours([
      {
        name: flours[0]?.name ?? '',
        pctOfFinished: flours.reduce((s, f) => s + f.pctOfFinished, 0),
        pctOfFlour: flours.reduce((s, f) => s + f.pctOfFlour, 0),
      },
    ]);
    setMerged(true);
  }

  function done() {
    if (!source) return;
    const nonFlour = source.ingredients.filter((i) => i.kind !== 'flour');
    onDone([
      ...flours.map((f, i) => ({
        name: f.name.trim(),
        kind: 'flour' as IngredientKind,
        pctOfFinished: f.pctOfFinished,
        sortOrder: i,
      })),
      ...nonFlour.map((i, n) => ({
        name: i.name,
        kind: i.kind,
        pctOfFinished: i.pctOfFinished,
        sortOrder: flours.length + n,
      })),
    ]);
  }

  // STEP 1 — which recipe
  if (!source) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">
          {t('settings.copy_pick_source')}
        </div>
        <div className="space-y-1.5">
          {sources.map((s) => (
            <button
              key={s.breadTypeId}
              onClick={() => pick(s)}
              className="w-full flex items-baseline justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-start hover:bg-muted/50 transition-colors"
            >
              <span className="font-medium text-sm">{s.breadTypeName}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {s.ingredients.length} {t('settings.ingredients_count')}
                {s.hydrationPct != null && ` · ${t('settings.hydration')} ${s.hydrationPct}%`}
              </span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('payments.cancel')}
        </Button>
      </div>
    );
  }

  // STEP 2 — which flour
  const passthrough = groupByKind(source.ingredients.filter((i) => i.kind !== 'flour'));

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-muted-foreground">
        {t('settings.copy_flours_title')}
      </div>

      <div className="space-y-2">
        {flours.map((f, idx) => (
          <div key={idx} className="grid grid-cols-[3.25rem_1fr] gap-2 items-center">
            <span className="text-sm font-bold tabular-nums text-muted-foreground">
              {f.pctOfFlour.toFixed(0)}%
            </span>
            <IngredientNameInput
              value={f.name}
              onChange={(v) =>
                setFlours((prev) => prev.map((x, i) => (i === idx ? { ...x, name: v } : x)))
              }
              kind="flour"
              namesByKind={namesByKind}
            />
          </div>
        ))}
      </div>

      {/* Offered only where there is something to merge, and reversible until
          you continue. */}
      {original.length > 1 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={
            merged
              ? () => {
                  setFlours(original);
                  setMerged(false);
                }
              : mergeFlours
          }
        >
          {merged ? t('settings.copy_unmerge_flours') : t('settings.copy_merge_flours')}
        </Button>
      )}

      <div className="rounded-md bg-muted/40 p-2 text-xs space-y-1">
        <div className="text-muted-foreground">{t('settings.copy_flours_hint')}</div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground tabular-nums">
          {passthrough.flatMap((g) =>
            g.items.map((i) => (
              <span key={`${g.kind}-${i.name}`}>
                {i.name} {i.pctOfFlour.toFixed(0)}%
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={flours.some((f) => !f.name.trim())}
          onClick={done}
        >
          {t('settings.copy_continue')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSource(null)}>
          {t('settings.copy_back')}
        </Button>
      </div>
    </div>
  );
}
