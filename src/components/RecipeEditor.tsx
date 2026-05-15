'use client';

import { useEffect, useState, useMemo } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Trash2, Pencil, Calculator } from 'lucide-react';
import { groupByKind, type IngredientKind } from '@/lib/recipe';

interface StoredIngredient {
  name: string;
  kind: IngredientKind;
  pctOfFinished: number;
  sortOrder: number;
}
interface BakersPercentIngredient extends StoredIngredient {
  pctOfFlour: number;
}
interface FetchedRecipe {
  ingredients: StoredIngredient[];
  bakersPercents: BakersPercentIngredient[];
  updatedAt: string;
}
interface EditorRow {
  name: string;
  kind: IngredientKind;
  grams: string;
  sortOrder: number;
}

const KIND_OPTIONS: IngredientKind[] = ['flour', 'water', 'salt', 'starter', 'other'];

function defaultTemplate(referenceWeight: number): EditorRow[] {
  // 100% flour, 70% water, 2% salt, 20% starter — standard sourdough starting point
  // Ratio: 1g flour produces ~1.4286g of finished bread (1000/700 from the canonical example)
  // So flour = referenceWeight × 0.7 / 1 (approximate; baker tweaks)
  const flour = Math.round(referenceWeight * 0.7);
  return [
    { name: 'קמח', kind: 'flour', grams: String(flour), sortOrder: 0 },
    { name: 'מים', kind: 'water', grams: String(Math.round(flour * 0.7)), sortOrder: 1 },
    { name: 'מלח', kind: 'salt', grams: String(Math.round(flour * 0.02)), sortOrder: 2 },
    { name: 'מחמצת', kind: 'starter', grams: String(Math.round(flour * 0.2)), sortOrder: 3 },
  ];
}

function pctOfFlourFromRows(rows: EditorRow[]): { pcts: { name: string; pctOfFlour: number }[]; totalDoughGrams: number } {
  const totalFlour = rows
    .filter((r) => r.kind === 'flour')
    .reduce((sum, r) => sum + (Number(r.grams) || 0), 0);
  const totalDoughGrams = rows.reduce((sum, r) => sum + (Number(r.grams) || 0), 0);
  if (totalFlour <= 0) return { pcts: [], totalDoughGrams };
  return {
    pcts: rows.map((r) => ({
      name: r.name,
      pctOfFlour: ((Number(r.grams) || 0) / totalFlour) * 100,
    })),
    totalDoughGrams,
  };
}

export interface RecipeEditorProps {
  breadTypeId: number;
  /** Default reference weight to use when opening the editor for the first time (e.g. first enabled size's weightGrams). */
  defaultReferenceWeight: number | null;
}

export function RecipeEditor({ breadTypeId, defaultReferenceWeight }: RecipeEditorProps) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();

  const [recipe, setRecipe] = useState<FetchedRecipe | null>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [refWeight, setRefWeight] = useState<string>(
    defaultReferenceWeight != null ? String(defaultReferenceWeight) : ''
  );
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Show-in-grams expander state
  const [displayWeight, setDisplayWeight] = useState<string>(
    defaultReferenceWeight != null ? String(defaultReferenceWeight) : '1000'
  );
  const [showGrams, setShowGrams] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ recipe: FetchedRecipe | null }>(`/bread-types/${breadTypeId}/recipe`)
      .then((res) => {
        if (cancelled) return;
        setRecipe(res.recipe);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [breadTypeId]);

  function startCreate() {
    const weight = defaultReferenceWeight ?? 1000;
    setRefWeight(String(weight));
    setRows(defaultTemplate(weight));
    setEditing(true);
  }

  function startEdit() {
    if (!recipe) return;
    const weight = Number(displayWeight) || defaultReferenceWeight || 1000;
    setRefWeight(String(weight));
    setRows(
      recipe.ingredients
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({
          name: i.name,
          kind: i.kind,
          grams: String(Math.round((i.pctOfFinished * weight) / 100)),
          sortOrder: i.sortOrder,
        }))
    );
    setEditing(true);
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { name: '', kind: 'other', grams: '', sortOrder: prev.length },
    ]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sortOrder: i })));
  }

  function updateRow(idx: number, patch: Partial<EditorRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const previewPcts = useMemo(() => pctOfFlourFromRows(rows), [rows]);

  async function save() {
    const refW = Number(refWeight);
    if (!refW || refW <= 0) {
      toast.error(t('settings.reference_weight'));
      return;
    }
    const validRows = rows.filter((r) => r.name.trim() && Number(r.grams) > 0);
    if (validRows.length === 0) {
      toast.error(t('settings.recipe_no_flour'));
      return;
    }
    if (!validRows.some((r) => r.kind === 'flour')) {
      toast.error(t('settings.recipe_no_flour'));
      return;
    }
    const totalGrams = validRows.reduce((sum, r) => sum + Number(r.grams), 0);
    if (totalGrams < refW) {
      toast.error(t('settings.recipe_save_failed'));
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/bread-types/${breadTypeId}/recipe`, {
        method: 'PUT',
        body: JSON.stringify({
          referenceFinishedGrams: refW,
          ingredients: validRows.map((r, i) => ({
            name: r.name.trim(),
            kind: r.kind,
            grams: Number(r.grams),
            sortOrder: i,
          })),
        }),
      });
      const fresh = await apiFetch<{ recipe: FetchedRecipe | null }>(
        `/bread-types/${breadTypeId}/recipe`
      );
      setRecipe(fresh.recipe);
      setEditing(false);
      setDisplayWeight(String(refW));
      setShowGrams(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.recipe_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecipe() {
    if (!confirm(t('settings.recipe_delete_confirm'))) return;
    try {
      await apiFetch(`/bread-types/${breadTypeId}/recipe`, { method: 'DELETE' });
      setRecipe(null);
      setEditing(false);
    } catch {
      toast.error(t('settings.recipe_save_failed'));
    }
  }

  if (loading) {
    return (
      <div className="border-t border-border pt-3">
        <div className="text-sm font-medium text-muted-foreground mb-2">{t('settings.recipe')}</div>
        <div className="h-16 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  // EDITOR UI (state A or edit-from-state-B)
  if (editing) {
    return (
      <div className="border-t border-border pt-3 space-y-3">
        <div className="text-sm font-medium text-muted-foreground">{t('settings.recipe')}</div>

        <Input
          label={t('settings.reference_weight')}
          type="number"
          inputMode="numeric"
          value={refWeight}
          onChange={(e) => setRefWeight(e.target.value)}
        />

        <div className="space-y-2">
          {rows.map((r, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-1.5 items-center">
              <Input
                value={r.name}
                onChange={(e) => updateRow(idx, { name: e.target.value })}
                placeholder={t('settings.ingredient')}
                className="text-sm"
              />
              <select
                value={r.kind}
                onChange={(e) => updateRow(idx, { kind: e.target.value as IngredientKind })}
                className="rounded-lg border border-border bg-card px-2 py-2 text-sm"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {t(`settings.kind_${k}`)}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                inputMode="numeric"
                value={r.grams}
                onChange={(e) => updateRow(idx, { grams: e.target.value })}
                placeholder="g"
              />
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 h-8 w-8"
                onClick={() => removeRow(idx)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <Button size="sm" variant="ghost" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" />
          {t('settings.add_ingredient')}
        </Button>

        {/* Live preview of baker's percentages */}
        {previewPcts.pcts.length > 0 && (
          <div className="rounded-md bg-muted/50 p-2 text-xs space-y-1">
            <div className="font-medium text-muted-foreground">{t('settings.bakers_pct')}</div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {previewPcts.pcts.map((p, i) => (
                <span key={i} className="tabular-nums">
                  {p.name} {p.pctOfFlour.toFixed(0)}%
                </span>
              ))}
            </div>
            <div className="text-muted-foreground tabular-nums pt-1 border-t border-border/40">
              {t('settings.dough_total')}: {previewPcts.totalDoughGrams}ג ·{' '}
              {t('settings.finished_weight')}: {refWeight || '0'}ג
            </div>
          </div>
        )}

        <div className="flex gap-2 items-center">
          <Button size="sm" className="flex-1" loading={saving} onClick={save}>
            {t('settings.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t('payments.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  // STATE A: no recipe configured
  if (!recipe) {
    return (
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-sm font-medium text-muted-foreground">{t('settings.recipe')}</div>
        <Card className="bg-muted/30 text-center py-3 space-y-2">
          <p className="text-xs text-muted-foreground">{t('settings.no_recipe')}</p>
          <Button size="sm" variant="outline" onClick={startCreate}>
            <Plus className="h-3.5 w-3.5" />
            {t('settings.set_recipe')}
          </Button>
        </Card>
      </div>
    );
  }

  // STATE B: recipe configured — manager view
  const dispW = Number(displayWeight) || 0;
  const grouped = groupByKind(recipe.bakersPercents);
  const totalFlourG = recipe.bakersPercents
    .filter((i) => i.kind === 'flour')
    .reduce((sum, i) => sum + (i.pctOfFinished * dispW) / 100, 0);
  const totalDoughG = recipe.bakersPercents.reduce(
    (sum, i) => sum + (i.pctOfFinished * dispW) / 100,
    0
  );

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-muted-foreground">{t('settings.recipe')}</div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 h-8 w-8"
            onClick={deleteRecipe}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Baker's percentages list, grouped by kind */}
      <div className="space-y-2">
        {grouped.map((g) => (
          <div key={g.kind} className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t(`settings.kind_${g.kind}`)}
            </div>
            {g.items.map((i, idx) => (
              <div key={idx} className="text-sm flex justify-between gap-2">
                <span>{i.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {i.pctOfFlour.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Show-in-grams expander */}
      <div className="border-t border-border/40 pt-2">
        {!showGrams ? (
          <button
            onClick={() => setShowGrams(true)}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            <Calculator className="h-3 w-3" />
            {t('settings.show_in_grams')}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">
                {t('settings.show_in_grams')}
              </span>
              <Input
                type="number"
                inputMode="numeric"
                value={displayWeight}
                onChange={(e) => setDisplayWeight(e.target.value)}
                className="flex-1 max-w-28"
              />
              <span className="text-xs text-muted-foreground">ג</span>
            </div>
            <div className="space-y-2 text-xs bg-muted/40 rounded-md p-2">
              {grouped.map((g) => (
                <div key={g.kind} className="space-y-0.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {t(`settings.kind_${g.kind}`)}
                  </div>
                  {g.items.map((i, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span>{i.name}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {Math.round((i.pctOfFinished * dispW) / 100)}ג
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="pt-1 mt-1 border-t border-border/40 text-muted-foreground tabular-nums flex flex-wrap gap-x-3">
                <span>{t('baker.total_flour')}: {Math.round(totalFlourG)}ג</span>
                <span>{t('settings.dough_total')}: {Math.round(totalDoughG)}ג</span>
                <span>{t('settings.finished_weight')}: {dispW}ג</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
