'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import type { MediaAsset } from '@/components/site-editor/MediaLibrary';
import { DetailsSection } from './sections/DetailsSection';
import { RecipeSection } from './sections/RecipeSection';
import { SizesSection } from './sections/SizesSection';
import { TiersSection } from './sections/TiersSection';
import { AdditionsSection } from './sections/AdditionsSection';
import { BrandingSection, type Branding } from './sections/BrandingSection';
import type { Tier, TypeDetailAddition, TypeDetailSize } from './types';

type SectionKey = 'details' | 'recipe' | 'sizes' | 'tiers' | 'additions' | 'branding';

/**
 * The full-screen bread editor.
 *
 * Its job is only the shell: load the detail once, hand each section its slice,
 * track which sections have unsaved changes, and refuse to close quietly over
 * them. Every section owns its own endpoint and its own save — deliberately,
 * because neon-http has no transactions and a single button over four
 * sequential writes would hide the seam rather than remove it. The sizes PUT is
 * already clean-slate, so a drop mid-save can leave a bread with no sizes at
 * all; better that the owner sees which block failed.
 */
export function BreadSheet({
  typeId,
  typeName,
  groupId,
  isBaker,
  assets,
  tiers,
  onClose,
  onNameSaved,
  onSizesSaved,
  onAdditionsSaved,
  onTiersSaved,
  onDeleted,
}: {
  typeId: number;
  typeName: string;
  groupId: number;
  isBaker: boolean;
  assets: MediaAsset[];
  tiers: Tier[];
  onClose: () => void;
  onNameSaved: (name: string) => void;
  onSizesSaved: (sizes: TypeDetailSize[]) => void;
  onAdditionsSaved: (additions: TypeDetailAddition[]) => void;
  onTiersSaved: (tiers: Tier[]) => void;
  onDeleted: () => void;
}) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();

  const [sizes, setSizes] = useState<TypeDetailSize[]>([]);
  const [additions, setAdditions] = useState<TypeDetailAddition[]>([]);
  const [branding, setBranding] = useState<Branding>({
    badgeType: null,
    badgeLabel: null,
    badgeIcon: null,
    imageId: null,
  });
  const [loading, setLoading] = useState(true);

  // Only פרטים starts open. The complaint about this sheet was its length:
  // name, badges, an image picker, the whole recipe editor, size chips, tier
  // overrides, a badge picker per size, additions, save and delete in one
  // scroll. Each header carries a summary so collapsed still says something.
  const [open, setOpen] = useState<SectionKey | null>('details');
  const [dirty, setDirty] = useState<Record<SectionKey, boolean>>({
    details: false,
    recipe: false,
    sizes: false,
    tiers: false,
    additions: false,
    branding: false,
  });

  // One stable callback per section. A freshly-built closure each render would
  // make every section's dirty effect re-run forever once it lists the callback
  // as a dependency; setDirty also bails when nothing changed.
  const markDirty = useMemo(() => {
    const make = (key: SectionKey) => (value: boolean) =>
      setDirty((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
    return {
      details: make('details'),
      recipe: make('recipe'),
      sizes: make('sizes'),
      tiers: make('tiers'),
      additions: make('additions'),
      branding: make('branding'),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{
      breadType: {
        sizes: TypeDetailSize[];
        additions: TypeDetailAddition[];
        badgeType: string | null;
        badgeLabel: string | null;
        badgeIcon: string | null;
        imageId: number | null;
      };
    }>(`/groups/${groupId}/bread-types/${typeId}`)
      .then(({ breadType }) => {
        if (cancelled) return;
        setSizes(breadType.sizes);
        setAdditions(breadType.additions);
        setBranding({
          badgeType: breadType.badgeType,
          badgeLabel: breadType.badgeLabel,
          badgeIcon: breadType.badgeIcon,
          imageId: breadType.imageId,
        });
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, typeId]);

  const dirtyLabels: Record<SectionKey, string> = {
    details: t('catalog.section_details'),
    recipe: t('settings.recipe'),
    sizes: t('catalog.section_sizes'),
    tiers: t('catalog.tier_overrides'),
    additions: t('settings.enabled_additions'),
    branding: t('site.type_branding'),
  };

  function close() {
    const pending = (Object.keys(dirty) as SectionKey[]).filter((k) => dirty[k]);
    if (pending.length > 0) {
      const names = pending.map((k) => dirtyLabels[k]).join(', ');
      if (!window.confirm(t('catalog.leave_unsaved').replace('{sections}', names))) return;
    }
    onClose();
  }

  async function deleteType() {
    if (!window.confirm(t('catalog.delete_type_confirm'))) return;
    try {
      await apiFetch(`/bread-types/${typeId}?hard=true`, { method: 'DELETE' });
      onDeleted();
    } catch {
      toast.error(t('settings.delete_failed'));
    }
  }

  const referenceWeight =
    sizes.find((s) => s.enabled && s.weightGrams != null)?.weightGrams ?? null;

  const toggle = (key: SectionKey) => () => setOpen((prev) => (prev === key ? null : key));

  return (
    <div className="fixed inset-0 z-50 animate-fade-in overflow-y-auto bg-background pb-24">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card/50 px-2 py-2 backdrop-blur-sm">
        <button
          type="button"
          aria-label={t('catalog.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center"
          onClick={close}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <h1 className="truncate text-lg font-bold">{typeName}</h1>
      </div>

      <div className="space-y-2 p-4">
        {loading ? (
          <>
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
          </>
        ) : (
          <>
            <DetailsSection
              typeId={typeId}
              name={typeName}
              isBaker={isBaker}
              open={open === 'details'}
              onToggle={toggle('details')}
              onDirtyChange={markDirty.details}
              onSaved={onNameSaved}
            />

            <RecipeSection
              typeId={typeId}
              defaultReferenceWeight={referenceWeight}
              open={open === 'recipe'}
              onToggle={toggle('recipe')}
              onDirtyChange={markDirty.recipe}
            />

            <SizesSection
              typeId={typeId}
              groupId={groupId}
              sizes={sizes}
              isBaker={isBaker}
              open={open === 'sizes'}
              onToggle={toggle('sizes')}
              onDirtyChange={markDirty.sizes}
              onSaved={(next) => {
                setSizes(next);
                onSizesSaved(next);
              }}
            />

            {!isBaker && (
              <TiersSection
                typeId={typeId}
                sizes={sizes}
                tiers={tiers}
                open={open === 'tiers'}
                onToggle={toggle('tiers')}
                onDirtyChange={markDirty.tiers}
                onSaved={onTiersSaved}
              />
            )}

            <AdditionsSection
              typeId={typeId}
              groupId={groupId}
              additions={additions}
              isBaker={isBaker}
              open={open === 'additions'}
              onToggle={toggle('additions')}
              onDirtyChange={markDirty.additions}
              onSaved={(next) => {
                setAdditions(next);
                onAdditionsSaved(next);
              }}
            />

            {!isBaker && (
              <BrandingSection
                typeId={typeId}
                branding={branding}
                assets={assets}
                open={open === 'branding'}
                onToggle={toggle('branding')}
                onDirtyChange={markDirty.branding}
                onSaved={setBranding}
              />
            )}

            {!isBaker && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-destructive hover:bg-destructive/10"
                onClick={deleteType}
              >
                <Trash2 className="h-4 w-4" />
                {t('settings.delete')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
