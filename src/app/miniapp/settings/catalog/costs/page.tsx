'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StickySaveBar } from '@/components/ui/StickySaveBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Wheat, Trash2, Sparkles, Lock } from 'lucide-react';
import { cn, friendlyError } from '@/lib/utils';
import {
  KIND_DISPLAY_ORDER,
  kindLabel,
  kindLabelIsUseful,
  scaleRecipe,
  type IngredientKind,
} from '@/lib/recipe';
import {
  costScaledRecipe,
  homeMadePricePerKg,
  priceKey,
  type HomeMadeSettings,
  type PriceBook,
} from '@/lib/cost';
import {
  buildDrafts,
  WATER_NAME,
  defaultDraft,
  draftToSettings,
  missingForHomeMade,
  type HomeMadeDraft,
} from '@/lib/home-made-drafts';

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
  homeMade: HomeMadeSettings[];
  homeMadeOrphans: HomeMadeSettings[];
  breads: Bread[];
}

/** Picker value for "a name not in the list; type it". */
const OTHER = '__other__';

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
  // One draft per home-made ingredient, by priceKey(name, kind).
  const [homeMadeByKey, setHomeMadeByKey] = useState<Record<string, HomeMadeDraft>>({});
  // Which pickers are showing their "type a new name" box.
  const [typing, setTyping] = useState<Record<string, { flour?: boolean; liquid?: boolean }>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  // The link to this screen is hidden for bakers, but the URL is still typeable
  // and the endpoint 403s. "No recipes yet" would be a lie about why.
  const [denied, setDenied] = useState(false);
  // A failed fetch left `data` null, which fell through to the "no recipes yet"
  // empty state — telling the owner their bakery has no recipes when the
  // network simply dropped.
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(
    () =>
      apiFetch<Payload>('/ingredient-prices')
        .then((r) => {
          setData(r);
          setPriceByKey(
            Object.fromEntries(r.prices.map((p) => [priceKey(p.name, p.kind), p.pricePerKg]))
          );
          setHomeMadeByKey(
            buildDrafts(
              r.homeMade,
              r.inUse,
              r.inUse.find((i) => i.kind === 'water')?.name ?? WATER_NAME
            )
          );
          setTyping({});
          setRemoved([]);
        })
        .catch((e: Error) => {
          if (/403|owners and managers/i.test(e.message)) setDenied(true);
          else {
            console.warn('[costs] load failed', e);
            setLoadFailed(true);
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPrice(key: string, value: string) {
    setPriceByKey((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const savedByKey = useMemo(
    () => Object.fromEntries((data?.homeMade ?? []).map((h) => [priceKey(h.name, h.kind), h])),
    [data]
  );
  const inUseKeys = useMemo(
    () => new Set((data?.inUse ?? []).map((i) => priceKey(i.name, i.kind))),
    [data]
  );
  const removedSet = useMemo(() => new Set(removed), [removed]);

  // The drafts that are sent and costed: in a recipe now, or a saved row kept
  // (not removed) while its name sits in no recipe.
  const activeDrafts = useMemo(
    () =>
      Object.entries(homeMadeByKey).filter(
        ([key]) => inUseKeys.has(key) || (key in savedByKey && !removedSet.has(key))
      ),
    [homeMadeByKey, inUseKeys, savedByKey, removedSet]
  );

  /**
   * A half-typed hydration or waste falls back to the value already stored (else
   * the kind's default), not to a constant: clearing the box to retype it used
   * to show a loaf at a different cost than the one about to be saved, and
   * saving in that state wrote the constant over the stored number.
   */
  const homeMadeSettings: HomeMadeSettings[] = useMemo(
    () => activeDrafts.map(([key, d]) => draftToSettings(d, savedByKey[key])),
    [activeDrafts, savedByKey]
  );

  /** The draft, in the shape the cost engine reads. Blank ≠ zero: a blank field
   *  is "no price", which keeps the loaf explicitly incomplete. */
  const book: PriceBook = useMemo(() => {
    const homeMade: Record<string, HomeMadeSettings> = Object.fromEntries(
      homeMadeSettings.map((h) => [priceKey(h.name, h.kind), h])
    );
    const pricePerKg: Record<string, number> = {};
    for (const [key, raw] of Object.entries(priceByKey)) {
      // A home-made ingredient is derived, so a typed price for it is dropped
      // here and, on save, pruned.
      if (removed.includes(key) || key in homeMade) continue;
      const value = Number(raw);
      if (raw.trim() !== '' && Number.isFinite(value) && value >= 0) pricePerKg[key] = value;
    }
    return { pricePerKg, homeMade };
  }, [priceByKey, removed, homeMadeSettings]);

  const derivedFor = (key: string): number | null => {
    const s = book.homeMade[key];
    return s ? homeMadePricePerKg(s, book) : null;
  };

  const inUseFlours = (data?.inUse ?? []).filter((i) => i.kind === 'flour').map((i) => i.name);
  // Names the home-made ingredients are fed with count as used, so their typed
  // price is not offered for deletion as an orphan.
  const feedingKeys = new Set(
    homeMadeSettings.flatMap((h) => [
      ...(h.flourName ? [priceKey(h.flourName, 'flour')] : []),
      priceKey(h.liquidName, h.liquidKind),
    ])
  );
  const visibleDrafts = activeDrafts.filter(([key]) => inUseKeys.has(key));
  const homeMadeOrphans = (data?.homeMadeOrphans ?? []).filter(
    (h) => !removedSet.has(priceKey(h.name, h.kind))
  );

  function patchDraft(key: string, patch: Partial<HomeMadeDraft>) {
    setHomeMadeByKey((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setDirty(true);
  }
  function markHomeMade(item: InUse) {
    const water = (data?.inUse ?? []).find((i) => i.kind === 'water')?.name ?? WATER_NAME;
    setHomeMadeByKey((prev) => ({
      ...prev,
      [priceKey(item.name, item.kind)]: defaultDraft(item.name, 'other', water),
    }));
    setDirty(true);
  }
  function unmarkHomeMade(key: string) {
    setHomeMadeByKey((prev) => {
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
    setDirty(true);
  }

  const orphans = (data?.orphans ?? []).filter((o) => {
    const key = priceKey(o.name, o.kind);
    return !removedSet.has(key) && !feedingKeys.has(key) && !(key in book.homeMade);
  });
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
      // book.pricePerKg already leaves out home-made keys, so the prune drops
      // their typed price in this same save.
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
          homeMade: homeMadeSettings,
        }),
      });
      // Reload rather than patch local state: the save changes which prices are
      // orphaned and which ingredients are in use, and a removed orphan that
      // stayed in local state would reappear and be re-inserted on the next save.
      await load();
      setDirty(false);
      toast.success(t('costs.saved'));
    } catch (e) {
      toast.error(friendlyError(e, t('costs.save_failed')));
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

  if (denied) {
    return (
      <>
        <PageHeader title={t('costs.title')} />
        <EmptyState icon={Lock} title={t('costs.denied')} />
      </>
    );
  }

  if (loadFailed) {
    return (
      <>
        <PageHeader title={t('costs.title')} />
        <EmptyState
          icon={Wheat}
          title={t('costs.load_failed')}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoadFailed(false);
                setLoading(true);
                load().finally(() => setLoading(false));
              }}
            >
              {t('costs.retry')}
            </Button>
          }
        />
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
      <div className="p-5 space-y-4 animate-fade-in">
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
                const isHomeMade = key in book.homeMade;
                const derived = derivedFor(key);
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{item.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {t('costs.used_by')} {item.usedBy.slice(0, 3).join(', ')}
                        {item.usedBy.length > 3 &&
                          ` ${t('catalog.and_more')} ${item.usedBy.length - 3}`}
                      </div>
                    </div>

                    {isHomeMade ? (
                      // Made here, not bought: its price comes from the card
                      // below, so there is nothing here to type into.
                      <div className="flex items-center gap-1.5 text-sm">
                        {derived === null ? (
                          <span className="text-xs text-muted-foreground">
                            {t('costs.home_made_not_set_up')}
                          </span>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                            <Money value={derived} className="font-semibold" />
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
                        {item.kind === 'other' && (
                          <button
                            type="button"
                            onClick={() => markHomeMade(item)}
                            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                          >
                            {t('costs.mark_home_made')}
                          </button>
                        )}
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
        {(orphans.length > 0 || homeMadeOrphans.length > 0) && (
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
            {homeMadeOrphans.map((h) => {
              const key = priceKey(h.name, h.kind);
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 text-sm truncate">
                    {h.name}
                    <span className="text-[11px] text-muted-foreground">
                      {' '}
                      · {t('costs.home_made_block')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRemoved((prev) => [...prev, key]);
                      setDirty(true);
                    }}
                    aria-label={`${t('costs.remove')} ${h.name}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </Card>
        )}

        {/* HOME-MADE: starters and anything else made here, priced from what
            they are made of. */}
        <Card className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-bold">{t('costs.home_made_block')}</h2>
            <p className="text-xs text-muted-foreground">{t('costs.home_made_hint')}</p>
          </div>

          {visibleDrafts.map(([key, d]) => {
            const settings = book.homeMade[key];
            const item = (data?.inUse ?? []).find((i) => priceKey(i.name, i.kind) === key);
            const price = derivedFor(key);
            const missing = settings ? missingForHomeMade(settings, book) : null;
            const mode = typing[key] ?? {};

            // Flours: in a recipe, or with a typed price, or the current one.
            const flourOptions = [
              ...new Set([
                ...inUseFlours,
                ...Object.keys(priceByKey)
                  .filter((k) => k.endsWith('|flour') && !removedSet.has(k))
                  .map((k) => k.slice(0, k.lastIndexOf('|'))),
                ...(d.flourName ? [d.flourName] : []),
              ]),
            ];
            // Liquids: water in a recipe, `other` that is priced or in a recipe
            // and not itself home-made, or the current one.
            const liquidOptions = new Map<string, { name: string; kind: 'water' | 'other' }>();
            const addLiquid = (name: string, kind: 'water' | 'other') =>
              liquidOptions.set(priceKey(name, kind), { name, kind });
            for (const i of data?.inUse ?? []) {
              if (i.kind === 'water') addLiquid(i.name, 'water');
            }
            for (const i of data?.inUse ?? []) {
              const k = priceKey(i.name, i.kind);
              if (i.kind === 'other' && !(k in book.homeMade)) addLiquid(i.name, 'other');
            }
            for (const k of Object.keys(priceByKey)) {
              if (k.endsWith('|other') && !(k in book.homeMade) && !removedSet.has(k)) {
                addLiquid(k.slice(0, k.lastIndexOf('|')), 'other');
              }
            }
            if (d.liquidName.trim()) addLiquid(d.liquidName, d.liquidKind);
            const liquidValue = mode.liquid ? OTHER : priceKey(d.liquidName, d.liquidKind);

            // A flour or liquid that is not in the price list above has no box
            // there, so the card gives it one. (Keyed on "not in a recipe", not
            // on "has no price", or the box would vanish as the owner types.)
            const priceBoxes: { name: string; kind: 'flour' | 'other' }[] = [];
            if (d.flourName?.trim() && !inUseKeys.has(priceKey(d.flourName.trim(), 'flour'))) {
              priceBoxes.push({ name: d.flourName.trim(), kind: 'flour' });
            }
            if (
              d.liquidKind === 'other' &&
              d.liquidName.trim() &&
              !inUseKeys.has(priceKey(d.liquidName.trim(), 'other'))
            ) {
              priceBoxes.push({ name: d.liquidName.trim(), kind: 'other' });
            }

            const field =
              'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20';

            return (
              <div key={key} className="space-y-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{d.name}</div>
                    {item && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {t('costs.used_by')} {item.usedBy.slice(0, 3).join(', ')}
                        {item.usedBy.length > 3 &&
                          ` ${t('catalog.and_more')} ${item.usedBy.length - 3}`}
                      </div>
                    )}
                  </div>
                  {d.kind === 'other' && (
                    <button
                      type="button"
                      onClick={() => unmarkHomeMade(key)}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      {t('costs.unmark_home_made')}
                    </button>
                  )}
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('costs.home_made_flour')}
                  </span>
                  <select
                    value={mode.flour ? OTHER : (d.flourName ?? '')}
                    onChange={(e) => {
                      if (e.target.value === OTHER) {
                        setTyping((prev) => ({ ...prev, [key]: { ...prev[key], flour: true } }));
                        patchDraft(key, { flourName: null });
                      } else {
                        setTyping((prev) => ({ ...prev, [key]: { ...prev[key], flour: false } }));
                        patchDraft(key, { flourName: e.target.value || null });
                      }
                    }}
                    className={field}
                  >
                    <option value="">{t('costs.starter_pick_flour')}</option>
                    {flourOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    <option value={OTHER}>{t('costs.home_made_other_flour')}</option>
                  </select>
                  {mode.flour && (
                    <input
                      type="text"
                      maxLength={100}
                      value={d.flourName ?? ''}
                      onChange={(e) => patchDraft(key, { flourName: e.target.value })}
                      aria-label={t('costs.home_made_other_flour')}
                      className={field}
                    />
                  )}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('costs.home_made_liquid')}
                  </span>
                  <select
                    value={liquidValue}
                    onChange={(e) => {
                      if (e.target.value === OTHER) {
                        setTyping((prev) => ({ ...prev, [key]: { ...prev[key], liquid: true } }));
                        // A typed new liquid is an `other` ingredient.
                        patchDraft(key, { liquidKind: 'other', liquidName: '' });
                      } else {
                        setTyping((prev) => ({ ...prev, [key]: { ...prev[key], liquid: false } }));
                        const picked = liquidOptions.get(e.target.value);
                        if (picked) patchDraft(key, { liquidName: picked.name, liquidKind: picked.kind });
                      }
                    }}
                    className={field}
                  >
                    {[...liquidOptions.entries()].map(([k, o]) => (
                      <option key={k} value={k}>
                        {o.name}
                      </option>
                    ))}
                    <option value={OTHER}>{t('costs.home_made_other_liquid')}</option>
                  </select>
                  {mode.liquid && (
                    <input
                      type="text"
                      maxLength={100}
                      value={d.liquidName}
                      onChange={(e) => patchDraft(key, { liquidName: e.target.value })}
                      aria-label={t('costs.home_made_other_liquid')}
                      className={field}
                    />
                  )}
                </label>

                {priceBoxes.map((b) => {
                  const pk = priceKey(b.name, b.kind);
                  return (
                    <div key={pk} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          dir="ltr"
                          value={priceByKey[pk] ?? ''}
                          onChange={(e) => setPrice(pk, e.target.value)}
                          aria-label={`${t('costs.prices')} · ${b.name}`}
                          className="w-24 rounded-lg border border-input bg-card px-2.5 py-2 text-base tabular-nums outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {t('costs.unit')}
                        </span>
                      </div>
                    </div>
                  );
                })}

                <div className="flex gap-3">
                  <label className="flex flex-1 flex-col gap-1.5">
                    <span className="text-sm font-medium text-muted-foreground">
                      {t('costs.starter_hydration')}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={1000}
                      dir="ltr"
                      value={d.hydration}
                      onChange={(e) => patchDraft(key, { hydration: e.target.value })}
                      className={cn(field, 'tabular-nums')}
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
                      value={d.waste}
                      onChange={(e) => patchDraft(key, { waste: e.target.value })}
                      className={cn(field, 'tabular-nums')}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  {!settings?.flourName ? (
                    <span className="text-xs text-destructive">{t('costs.home_made_not_set_up')}</span>
                  ) : price === null ? (
                    <span className="text-xs text-destructive">
                      {t('costs.missing_price')}: {missing}
                    </span>
                  ) : (
                    <>
                      <Money value={price} className="font-semibold" />
                      <span className="text-xs text-muted-foreground">{t('costs.unit')}</span>
                      <span className="ms-auto text-[11px] text-muted-foreground">
                        {t('costs.starter_derived')}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
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
                        {missing.length > 2 && ` ${t('catalog.and_more')} ${missing.length - 2}`}
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

        {/* One save, and it only appears when there is something to save. */}
        {dirty && (
          <StickySaveBar>
            <Button className="w-full" onClick={save} loading={saving}>
              {t('costs.save')}
            </Button>
          </StickySaveBar>
        )}
      </div>
    </>
  );
}
