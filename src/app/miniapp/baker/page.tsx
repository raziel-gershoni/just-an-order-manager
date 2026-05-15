'use client';

import { useEffect, useState, useMemo } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChevronLeft, ChevronRight, ChefHat, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { format, addDays, parseISO } from 'date-fns';
import { groupByKind, type IngredientKind } from '@/lib/recipe';

interface ScaledIngredient {
  name: string;
  kind: IngredientKind;
  grams: number;
  pctOfFlour: number;
  sortOrder: number;
}
interface ScaledRecipe {
  ingredients: ScaledIngredient[];
  totalFlourGrams: number;
  totalDoughGrams: number;
  finishedGrams: number;
}
interface BySize {
  sizeId: number | null;
  sizeName: string | null;
  qty: number;
  finishedGrams: number | null;
  scaled: ScaledRecipe | null;
}
interface ByType {
  breadTypeId: number;
  name: string;
  totalLoaves: number;
  totalFinishedGrams: number;
  hasRecipe: boolean;
  recipe: ScaledRecipe | null;
  bySize: BySize[];
}
interface BakerData {
  date: string;
  byType: ByType[];
  unconfigured: { breadTypeId: number; name: string; reason: 'no_recipe' | 'size_missing_weight' }[];
}

function todayISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

function formatGrams(g: number): string {
  return `${Math.round(g)}ג`;
}

function ingredientLine(i: ScaledIngredient): string {
  return `${i.name} ${formatGrams(i.grams)} (${i.pctOfFlour.toFixed(0)}%)`;
}

export default function BakerPage() {
  const { apiFetch } = useApi();
  const { activeGroupId } = useGroup();
  const t = useT();

  const [date, setDate] = useState<string>(todayISO());
  const [data, setData] = useState<BakerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSizeBreakdown, setExpandedSizeBreakdown] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!activeGroupId) return;
    setLoading(true);
    apiFetch<BakerData>(`/baker?date=${date}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [activeGroupId, date]);

  const dateObj = useMemo(() => parseISO(date), [date]);

  function shiftDate(days: number) {
    setDate(format(addDays(dateObj, days), 'yyyy-MM-dd'));
  }

  function toggleBreakdown(typeId: number) {
    setExpandedSizeBreakdown((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });
  }

  return (
    <div className="p-5 space-y-5 animate-fade-in">
      <div className="flex items-center gap-2">
        <ChefHat className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">{t('baker.title')}</h1>
      </div>

      {/* Date picker */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <Button size="icon" variant="outline" onClick={() => shiftDate(-1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 bg-transparent text-center font-medium tabular-nums focus:outline-none"
          />
          <Button size="icon" variant="outline" onClick={() => shiftDate(1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {loading && (
        <div className="space-y-3">
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        </div>
      )}

      {!loading && data && data.byType.length === 0 && (
        <EmptyState icon={ChefHat} title={t('baker.no_orders')} />
      )}

      {!loading && data && data.byType.length > 0 && (
        <div className="space-y-3">
          {data.byType.map((typ) => (
            <Card key={typ.breadTypeId} className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{typ.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {typ.totalLoaves} {t('baker.loaves')} ·{' '}
                    {t('baker.expected_finished')}: {formatGrams(typ.totalFinishedGrams)}
                  </div>
                </div>
              </div>

              {typ.hasRecipe && typ.recipe ? (
                <>
                  <div className="border-t border-border pt-3 space-y-2">
                    {groupByKind(typ.recipe.ingredients).map((g) => (
                      <div key={g.kind} className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {t(`settings.kind_${g.kind}`)}
                        </div>
                        {g.items.map((i, idx) => (
                          <div key={idx} className="text-sm flex justify-between gap-3">
                            <span>{i.name}</span>
                            <span className="text-muted-foreground tabular-nums">
                              {formatGrams(i.grams)}
                              <span className="text-xs ms-1 opacity-60">({i.pctOfFlour.toFixed(0)}%)</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border pt-2 text-xs text-muted-foreground flex justify-between gap-2 flex-wrap">
                    <span>
                      {t('baker.total_flour')}: <span className="text-foreground font-medium tabular-nums">{formatGrams(typ.recipe.totalFlourGrams)}</span>
                    </span>
                    <span>
                      {t('baker.total_dough')}: <span className="text-foreground font-medium tabular-nums">{formatGrams(typ.recipe.totalDoughGrams)}</span>
                    </span>
                  </div>

                  {typ.bySize.length > 1 && (
                    <div className="border-t border-border pt-2">
                      <button
                        onClick={() => toggleBreakdown(typ.breadTypeId)}
                        className="text-xs text-primary hover:underline"
                      >
                        {expandedSizeBreakdown.has(typ.breadTypeId) ? '−' : '+'} {t('baker.by_size')}
                      </button>
                      {expandedSizeBreakdown.has(typ.breadTypeId) && (
                        <div className="mt-2 space-y-2">
                          {typ.bySize.map((s, idx) => (
                            <div key={idx} className="text-xs bg-muted/50 rounded-md p-2">
                              <div className="font-medium">
                                {s.sizeName ?? '—'} × {s.qty}
                              </div>
                              {s.scaled ? (
                                <div className="text-muted-foreground mt-1">
                                  {s.scaled.ingredients.map(ingredientLine).join(' · ')}
                                </div>
                              ) : (
                                <div className="text-muted-foreground mt-1">
                                  {t('baker.unconfigured_recipe')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                  {t('baker.unconfigured_recipe')} —{' '}
                  <Link href="/miniapp/settings/catalog" className="text-primary hover:underline">
                    {t('settings.title')}
                  </Link>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {!loading && data && data.unconfigured.length > 0 && (
        <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs space-y-1">
              <div className="font-medium text-amber-700 dark:text-amber-400">
                {t('baker.unconfigured_recipe')}
              </div>
              {data.unconfigured.map((u) => (
                <div key={u.breadTypeId} className="text-muted-foreground">
                  {u.name} —{' '}
                  <Link href="/miniapp/settings/catalog" className="text-primary hover:underline">
                    {t('settings.set_recipe')}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
