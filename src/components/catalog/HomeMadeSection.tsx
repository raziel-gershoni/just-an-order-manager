'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadError } from '@/components/ui/LoadError';
import { cn, friendlyError } from '@/lib/utils';
import { homeMadePricePerKg, priceKey, type HomeMadeSettings } from '@/lib/cost';
import {
  WATER_NAME,
  applyPreset,
  draftForEntry,
  draftToSettings,
  homeMadeConflict,
  missingForHomeMade,
  newEntryDraft,
  presetsFor,
  switchKind,
  type HomeMadeDraft,
  type HomeMadePreset,
} from '@/lib/home-made-drafts';
import type { HomeMadeCatalog, HomeMadeEntry } from '@/lib/ingredient-costs';

/** Picker value for "a name not in the list; type it". */
const OTHER = '__other__';

const field =
  'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20';

const PRESET_KEY: Record<HomeMadePreset, string> = {
  regular: 'catalog.home_made_preset_regular',
  stiff: 'catalog.home_made_preset_stiff',
  tangzhong: 'catalog.home_made_preset_tangzhong',
};

function Money({ value }: { value: number }) {
  return (
    <span dir="ltr" className="tabular-nums">
      ₪{value.toFixed(2)}
    </span>
  );
}

/**
 * The catalogue's "מכינים בעצמנו" section: define starters, tangzhong and
 * anything else made in-house, before any recipe uses them. Owner/manager only
 * (the page renders it for non-bakers; the route 403s bakers anyway).
 */
export function HomeMadeSection() {
  const { apiFetch } = useApi();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<HomeMadeCatalog | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Key of the row being edited, or 'new' for the add form.
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiFetch<HomeMadeCatalog>('/home-made')
        .then((r) => {
          setData(r);
          setLoadFailed(false);
        })
        .catch((e: Error) => {
          console.error('[home-made] load failed', e);
          setLoadFailed(true);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Load on mount so the header count shows while closed.
  useEffect(() => {
    load();
  }, [load]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Every open re-reads: the prices screen or a recipe may have changed things.
    if (next) load();
  }

  const defaultWater = data?.liquidOptions.find((o) => o.kind === 'water')?.name ?? WATER_NAME;

  return (
    <section>
      <button type="button" onClick={toggle} className="w-full flex items-center justify-between mb-2 group">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
          {t('catalog.home_made')}
          {data && (
            <span className="text-xs font-normal normal-case opacity-60 tabular-nums">
              · {data.entries.length}
            </span>
          )}
        </h2>
      </button>

      {open && (
        <>
          <p className="text-xs text-muted-foreground mb-3">{t('catalog.home_made_hint')}</p>

          {loadFailed ? (
            <Card className="p-3">
              <LoadError compact onRetry={load} />
            </Card>
          ) : !data ? (
            <div className="h-20 rounded-xl bg-muted animate-pulse" />
          ) : (
            <>
              {data.entries.length > 0 && (
                <Card className="p-0 overflow-hidden">
                  {data.entries.map((entry, idx) => {
                    const key = priceKey(entry.name, entry.kind);
                    const border = idx > 0 && 'border-t border-dashed border-border';
                    if (editing === key) {
                      return (
                        <HomeMadeEditor
                          key={key}
                          className={cn('animate-expand p-3 space-y-3', border)}
                          initial={draftForEntry(entry, defaultWater)}
                          saved={entry.saved ?? undefined}
                          adding={false}
                          options={data}
                          onCancel={() => setEditing(null)}
                          onDone={async () => {
                            setEditing(null);
                            await load();
                          }}
                          apiFetch={apiFetch}
                        />
                      );
                    }
                    return (
                      <EntryRow
                        key={key}
                        entry={entry}
                        data={data}
                        className={border || undefined}
                        onEdit={() => setEditing(key)}
                      />
                    );
                  })}
                </Card>
              )}

              {editing === 'new' ? (
                <HomeMadeEditor
                  className="mt-3 animate-expand"
                  card
                  initial={newEntryDraft(defaultWater)}
                  adding
                  options={data}
                  onCancel={() => setEditing(null)}
                  onDone={async () => {
                    setEditing(null);
                    await load();
                  }}
                  apiFetch={apiFetch}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className={data.entries.length > 0 ? 'mt-3' : undefined}
                  onClick={() => setEditing('new')}
                >
                  <Plus className="h-4 w-4" />
                  {t('catalog.home_made_add')}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function EntryRow({
  entry,
  data,
  className,
  onEdit,
}: {
  entry: HomeMadeEntry;
  data: HomeMadeCatalog;
  className?: string;
  onEdit: () => void;
}) {
  const t = useT();
  const s = entry.saved;
  const price = s ? homeMadePricePerKg(s, data.book) : null;
  const missing = s ? missingForHomeMade(s, data.book) : null;
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2.5', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium truncate">{entry.name}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {t(`settings.kind_${entry.kind}`)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {s?.flourName ? (
            <>
              {s.flourName} · {t('catalog.home_made_hydration')}{' '}
              <span dir="ltr" className="tabular-nums">
                {s.hydrationPct}%
              </span>
            </>
          ) : (
            t('costs.home_made_not_set_up')
          )}
        </div>
        {s?.flourName && (
          <div className="text-xs mt-0.5">
            {price !== null ? (
              <>
                <Money value={price} /> <span className="text-muted-foreground">{t('costs.unit')}</span>
              </>
            ) : (
              <Link
                href="/miniapp/settings/catalog/costs"
                className="text-destructive hover:underline"
              >
                {t('costs.missing_price')}: {missing}
              </Link>
            )}
          </div>
        )}
      </div>
      <Button size="icon" variant="ghost" onClick={onEdit} aria-label={entry.name}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function HomeMadeEditor({
  initial,
  saved,
  adding,
  options,
  className,
  card,
  onCancel,
  onDone,
  apiFetch,
}: {
  initial: HomeMadeDraft;
  saved?: HomeMadeSettings;
  adding: boolean;
  options: HomeMadeCatalog;
  className?: string;
  card?: boolean;
  onCancel: () => void;
  onDone: () => Promise<void>;
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const t = useT();
  const toast = useToast();
  const [d, setD] = useState<HomeMadeDraft>(initial);
  const [typingFlour, setTypingFlour] = useState(false);
  const [typingLiquid, setTypingLiquid] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<HomeMadeDraft>) => setD((prev) => ({ ...prev, ...p }));

  const flours = [...new Set([...options.flourOptions, ...(d.flourName?.trim() ? [d.flourName.trim()] : [])])];
  const liquids = new Map<string, { name: string; kind: 'water' | 'other' }>();
  for (const o of options.liquidOptions) liquids.set(priceKey(o.name, o.kind), o);
  if (d.liquidName.trim()) {
    liquids.set(priceKey(d.liquidName.trim(), d.liquidKind), {
      name: d.liquidName.trim(),
      kind: d.liquidKind,
    });
  }

  async function save() {
    const name = d.name.trim();
    if (adding) {
      // The same rules the server applies, so the owner hears it before a round trip.
      const conflict = homeMadeConflict({ name, kind: d.kind }, options.entries, { create: true });
      if (conflict) {
        toast.error(
          t(
            conflict.code === 'blank'
              ? 'catalog.home_made_err_blank'
              : conflict.code === 'control_chars'
                ? 'catalog.home_made_err_chars'
                : 'catalog.home_made_exists'
          )
        );
        return;
      }
    }
    setBusy(true);
    try {
      const settings = draftToSettings({ ...d, name }, saved);
      await apiFetch('/home-made', {
        method: 'PUT',
        body: JSON.stringify(adding ? { ...settings, create: true } : settings),
      });
      toast.success(t('catalog.home_made_saved'));
      await onDone();
    } catch (e) {
      // A 409 is the server's "this name and kind already exist" (a race with another device).
      if ((e as { status?: number }).status === 409) {
        console.warn('[home-made] add refused: exists', e);
        toast.error(t('catalog.home_made_exists'));
      } else {
        toast.error(friendlyError(e, t('catalog.save_failed')));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('catalog.home_made_delete_confirm').replace('{name}', d.name))) return;
    setBusy(true);
    try {
      await apiFetch(
        `/home-made?name=${encodeURIComponent(d.name)}&kind=${d.kind}`,
        { method: 'DELETE' }
      );
      toast.success(t('catalog.home_made_deleted'));
      await onDone();
    } catch (e) {
      toast.error(friendlyError(e, t('settings.delete_failed')));
    } finally {
      setBusy(false);
    }
  }

  const presets = presetsFor(adding ? 'add' : d.kind);

  const body = (
    <>
      {adding ? (
        <div className="space-y-1.5">
          <Input
            label={t('settings.name')}
            value={d.name}
            maxLength={100}
            onChange={(e) => patch({ name: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t('catalog.home_made_name_hint')}</p>
        </div>
      ) : (
        <div className="text-sm font-medium">{d.name}</div>
      )}

      {adding && (
        <div className="flex gap-2">
          {(['starter', 'tangzhong'] as const).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={d.kind === k ? 'primary' : 'outline'}
              className="flex-1"
              onClick={() => setD((prev) => switchKind(prev, k))}
            >
              {t(`settings.kind_${k}`)}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setD((prev) => applyPreset(prev, p, adding))}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground active:bg-muted"
          >
            {t(PRESET_KEY[p])}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">{t('costs.home_made_flour')}</span>
        <select
          value={typingFlour ? OTHER : (d.flourName ?? '')}
          onChange={(e) => {
            if (e.target.value === OTHER) {
              setTypingFlour(true);
              patch({ flourName: null });
            } else {
              setTypingFlour(false);
              patch({ flourName: e.target.value || null });
            }
          }}
          className={field}
        >
          <option value="">{t('costs.starter_pick_flour')}</option>
          {flours.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={OTHER}>{t('costs.home_made_other_flour')}</option>
        </select>
        {typingFlour && (
          <input
            type="text"
            maxLength={100}
            value={d.flourName ?? ''}
            onChange={(e) => patch({ flourName: e.target.value })}
            aria-label={t('costs.home_made_other_flour')}
            className={field}
          />
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">{t('costs.home_made_liquid')}</span>
        <select
          value={typingLiquid ? OTHER : priceKey(d.liquidName, d.liquidKind)}
          onChange={(e) => {
            if (e.target.value === OTHER) {
              setTypingLiquid(true);
              // A typed new liquid is an `other` ingredient.
              patch({ liquidKind: 'other', liquidName: '' });
            } else {
              setTypingLiquid(false);
              const picked = liquids.get(e.target.value);
              if (picked) patch({ liquidName: picked.name, liquidKind: picked.kind });
            }
          }}
          className={field}
        >
          {[...liquids.entries()].map(([k, o]) => (
            <option key={k} value={k}>
              {o.name}
            </option>
          ))}
          <option value={OTHER}>{t('costs.home_made_other_liquid')}</option>
        </select>
        {typingLiquid && (
          <input
            type="text"
            maxLength={100}
            value={d.liquidName}
            onChange={(e) => patch({ liquidName: e.target.value })}
            aria-label={t('costs.home_made_other_liquid')}
            className={field}
          />
        )}
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">{t('costs.starter_hydration')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            dir="ltr"
            value={d.hydration}
            onChange={(e) => patch({ hydration: e.target.value })}
            className={cn(field, 'tabular-nums')}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">{t('costs.starter_waste')}</span>
          <input
            type="number"
            inputMode="decimal"
            min={1}
            max={10}
            step="0.1"
            dir="ltr"
            value={d.waste}
            onChange={(e) => patch({ waste: e.target.value })}
            className={cn(field, 'tabular-nums')}
          />
        </label>
      </div>

      <div className="flex gap-2 items-center pt-1">
        <Button size="sm" className="flex-1" onClick={save} loading={busy} data-save-button>
          {adding ? t('form.add') : t('settings.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t('payments.cancel')}
        </Button>
        {!adding && (
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 h-8 w-8"
            onClick={remove}
            disabled={busy || !saved}
            aria-label={t('settings.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </>
  );

  return card ? (
    <Card data-save-scope className={cn('p-3 space-y-3', className)}>
      {body}
    </Card>
  ) : (
    <div data-save-scope className={className}>
      {body}
    </div>
  );
}
