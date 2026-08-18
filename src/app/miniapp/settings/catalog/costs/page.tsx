'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Wheat, Trash2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  KIND_DISPLAY_ORDER,
  kindLabel,
  kindLabelIsUseful,
  scaleRecipe,
  type IngredientKind,
} from '@/lib/recipe';
import { costScaledRecipe, priceKey, starterPricePerKg, type PriceBook } from '@/lib/cost';

interface PriceRow {
  name: string;
  kind: IngredientKind;
  pricePerKg: string;
}
interface InUse {
  name: string;
  kind: IngredientKind;
  usedBy: string[];
}
interface Bread {
  breadTypeId: number;
  breadTypeName: string;
  isActive: boolean;
  ingredients: { name: string; kind: IngredientKind; pctOfFinished: number; sortOrder: number }[];
  sizes: { sizeId: number; sizeName: string; weightGrams: number | null }[];
}
interface Payload {
  book: PriceBook;
  prices: PriceRow[];
  inUse: InUse[];
  orphans: PriceRow[];
  breads: Bread[];
}

/** ₪ with two decimals, kept LTR so it doesn't reorder inside Hebrew text. */
function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span dir="ltr" className={cn('tabular-nums', className)}>
      ₪{value.toFixed(2)}
    </span>
  );
}

/**
 * The ingredient price book, and what it makes a loaf cost.
 *
 * Costs recompute as the owner types rather than on save: the whole point of
 * the screen is watching a flour price move the loaf. That means the math runs
 * on the client, off the same pure src/lib/cost.ts the server would use.
 */
export default function CostsPage() {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Draft state. Prices are held as the strings the owner typed — parsing on
  // every keystroke would fight them over a half-typed "5." .
  const [priceByKey, setPriceByKey] = useState<Record<string, string>>({});
  const [flourName, setFlourName] = useState<string | null>(null);
  const [hydration, setHydration] = useState('100');
  const [waste, setWaste] = useState('1.5');
  const [removed, setRemoved] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    apiFetch<Payload>('/ingredient-prices')
      .then((r) => {
        setData(r);
        setPriceByKey(
          Object.fromEntries(r.prices.map((p) => [priceKey(p.name, p.kind), p.pricePerKg]))
        );
        setFlourName(r.book.starter.flourName);
        setHydration(String(r.book.starter.hydrationPct));
        setWaste(String(r.book.starter.wasteFactor));
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  function setPrice(key: string, value: string) {
    setPriceByKey((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  /** The draft, in the shape the cost engine reads. Blank ≠ zero: a blank field
   *  is "no price", which keeps the loaf explicitly incomplete. */
  const book: PriceBook = useMemo(() => {
    const pricePerKg: Record<string, number> = {};
    for (const [key, raw] of Object.entries(priceByKey)) {
      if (removed.includes(key)) continue;
      const value = Number(raw);
      if (raw.trim() !== '' && Number.isFinite(value) && value >= 0) pricePerKg[key] = value;
    }
    return {
      pricePerKg,
      starter: {
        flourName,
        hydrationPct: Number(hydration) || 0,
        wasteFactor: Number(waste) || 0,
      },
    };
  }, [priceByKey, removed, flourName, hydration, waste]);

  const starterPrice = starterPricePerKg(book);
  const flourNames = (data?.inUse ?? []).filter((i) => i.kind === 'flour').map((i) => i.name);
  const orphans = (data?.orphans ?? []).filter((o) => !removed.includes(priceKey(o.name, o.kind)));
  const hasAnyRecipe = (data?.breads ?? []).some((b) => b.ingredients.length > 0);
  const withRecipe = (data?.breads ?? []).filter((b) => b.ingredients.length > 0);
  // An inactive bread with no recipe is not worth a line; an inactive bread WITH
  // one still is, because it can sit on a live order.
  const noRecipeCount = (data?.breads ?? []).filter(
    (b) => b.ingredients.length === 0 && b.isActive
  ).length;
  const priced = Object.keys(book.pricePerKg);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const prices = Object.entries(book.pricePerKg).map(([key, value]) => {
        const sep = key.lastIndexOf('|');
        return {
          name: key.slice(0, sep),
          kind: key.slice(sep + 1) as IngredientKind,
          pricePerKg: value.toFixed(2),
        };
      });
      await apiFetch('/ingredient-prices', {
        method: 'PUT',
        body: JSON.stringify({
          prices,
          starter: {
            flourName,
            hydrationPct: Math.round(Number(hydration)) || 100,
            wasteFactor: Number(waste) || 1,
          },
        }),
      });
      setDirty(false);
      setRemoved([]);
      toast.success(t('costs.saved'));
    } catch (e) {
      toast.error((e as Error).message || t('costs.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('costs.title')} />
        <div className="p-5 space-y-4">
          <div className="h-40 rounded-xl bg-muted animate-pulse" />
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        </div>
      </>
    );
  }

  if (!hasAnyRecipe) {
    return (
      <>
        <PageHeader title={t('costs.title')} />
        <EmptyState
          icon={Wheat}
          title={t('costs.empty_title')}
          description={t('costs.empty_desc')}
          action={
            <Link href="/miniapp/settings/catalog">
              <Button size="sm" variant="outline">
                {t('costs.empty_action')}
              </Button>
            </Link>
          }
        />
      </>
    );
  }

  const byKind = KIND_DISPLAY_ORDER.map((kind) => ({
    kind,
    items: (data?.inUse ?? []).filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader title={t('costs.title')} />
      <div className="p-5 pb-32 space-y-4 animate-fade-in">
        {/* PRICES */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">{t('costs.prices')}</h2>

          {byKind.map((group) => (
            <div key={group.kind} className="space-y-2">
              {/* "מים" under a heading that also reads "מים" is noise. */}
              {kindLabelIsUseful(group.kind, group.items) && (
                <div className="text-xs font-medium text-muted-foreground">
                  {kindLabel(group.kind)}
                </div>
              )}
              {group.items.map((item) => {
                const key = priceKey(item.name, item.kind);
                const isStarter = item.kind === 'starter';
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{item.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {t('costs.used_by')} {item.usedBy.slice(0, 3).join(', ')}
                        {item.usedBy.length > 3 && ` +${item.usedBy.length - 3}`}
                      </div>
                    </div>

                    {isStarter ? (
                      // Starter is fed, not bought — its price comes from the
                      // block below, so there is nothing here to type into.
                      <div className="flex items-center gap-1.5 text-sm">
                        {starterPrice === null ? (
                          <span className="text-xs text-muted-foreground">
                            {t('costs.starter_derived')}
                          </span>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                            <Money value={starterPrice} className="font-semibold" />
                            <span className="text-xs text-muted-foreground">{t('costs.unit')}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          dir="ltr"
                          value={priceByKey[key] ?? ''}
                          onChange={(e) => setPrice(key, e.target.value)}
                          aria-label={`${t('costs.prices')} · ${item.name}`}
                          className="w-24 rounded-lg border border-input bg-card px-2.5 py-2 text-base tabular-nums outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {t('costs.unit')}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </Card>

        {/* ORPHANED PRICES — a renamed ingredient forks its price key silently.
            Listing the leftovers is what makes that visible. */}
        {orphans.length > 0 && (
          <Card className="space-y-2 border-destructive/40">
            <h2 className="text-sm font-bold">{t('costs.orphans')}</h2>
            <p className="text-xs text-muted-foreground">{t('costs.orphans_hint')}</p>
            {orphans.map((o) => {
              const key = priceKey(o.name, o.kind);
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 text-sm truncate">
                    {o.name}
                    <span className="text-[11px] text-muted-foreground"> · {kindLabel(o.kind)}</span>
                  </div>
                  <Money value={Number(o.pricePerKg)} className="text-sm text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => {
                      setRemoved((prev) => [...prev, key]);
                      setDirty(true);
                    }}
                    aria-label={`${t('costs.remove')} ${o.name}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </Card>
        )}

        {/* STARTER */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">{t('costs.starter_block')}</h2>
          <p className="text-xs text-muted-foreground">{t('costs.starter_hint')}</p>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              {t('costs.starter_flour')}
            </span>
            <select
              value={flourName ?? ''}
              onChange={(e) => {
                setFlourName(e.target.value || null);
                setDirty(true);
              }}
              className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="">{t('costs.starter_pick_flour')}</option>
              {flourNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">
                {t('costs.starter_hydration')}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                dir="ltr"
                value={hydration}
                onChange={(e) => {
                  setHydration(e.target.value);
                  setDirty(true);
                }}
                className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base tabular-nums outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">
                {t('costs.starter_waste')}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={10}
                step="0.1"
                dir="ltr"
                value={waste}
                onChange={(e) => {
                  setWaste(e.target.value);
                  setDirty(true);
                }}
                className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base tabular-nums outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('settings.kind_starter')}</span>
            {starterPrice === null ? (
              <span className="text-xs text-destructive">{t('costs.starter_unset')}</span>
            ) : (
              <>
                <Money value={starterPrice} className="font-semibold" />
                <span className="text-xs text-muted-foreground">{t('costs.unit')}</span>
                <span className="ms-auto text-[11px] text-muted-foreground">
                  {t('costs.starter_derived')}
                </span>
              </>
            )}
          </div>
        </Card>

        {/* COST PER LOAF */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">{t('costs.table')}</h2>

          {priced.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('costs.enter_prices_first')}</p>
          )}

          {withRecipe.map((bread) => (
            <div key={bread.breadTypeId} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn('text-sm font-medium', !bread.isActive && 'text-muted-foreground')}
                >
                  {bread.breadTypeName}
                </span>
                {!bread.isActive && (
                  <span className="text-[11px] text-muted-foreground">{t('settings.inactive')}</span>
                )}
              </div>

              {bread.sizes.map((size) => {
                if (size.weightGrams == null) {
                  return (
                    <div
                      key={size.sizeId}
                      className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
                    >
                      <span>{size.sizeName}</span>
                      <span>{t('costs.missing_weight')}</span>
                    </div>
                  );
                }
                const cost = costScaledRecipe(
                  scaleRecipe({ ingredients: bread.ingredients }, size.weightGrams),
                  book
                );
                const missing = cost.unpriced.map((u) => u.name);
                return (
                  <div
                    key={size.sizeId}
                    className="flex items-baseline justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {size.sizeName} ·{' '}
                      <span dir="ltr" className="tabular-nums">
                        {size.weightGrams}
                      </span>{' '}
                      {t('settings.grams')}
                    </span>
                    {cost.complete ? (
                      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                        <Money value={cost.total} className="font-semibold" />
                        <span className="text-xs text-muted-foreground">
                          <Money value={cost.perKg} /> {t('costs.unit')}
                        </span>
                      </span>
                    ) : (
                      <span className="min-w-0 truncate text-xs text-destructive">
                        {t('costs.missing_price')}: {missing.slice(0, 2).join(', ')}
                        {missing.length > 2 && ` +${missing.length - 2}`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Breads with no recipe are counted, not listed: fourteen identical
              "אין מתכון" rows bury the ones that do cost something. */}
          {noRecipeCount > 0 && (
            <Link
              href="/miniapp/settings/catalog"
              className="block text-xs text-muted-foreground hover:underline"
            >
              {t('costs.no_recipe')} · {noRecipeCount} {t('settings.bread_types')}
            </Link>
          )}

          <p className="border-t border-dashed border-border pt-2 text-[11px] text-muted-foreground">
            {t('costs.excludes_additions')}
          </p>
        </Card>
      </div>

      {/* One save, and it only appears when there is something to save. */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
          <Button className="w-full" onClick={save} loading={saving}>
            {t('costs.save')}
          </Button>
        </div>
      )}
    </>
  );
}
