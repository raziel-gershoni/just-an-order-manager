'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/hooks/useLang';
import { RecipeEditor } from '@/components/RecipeEditor';
import { SectionCard } from '../SectionCard';

/**
 * The recipe editor, in the sheet's section frame.
 *
 * It keeps its own save button — the recipe has its own endpoint and its own
 * validation, and an editor with a cancel needs the save beside it — so this
 * section passes no `onSave` and only reports dirty, which keeps the header dot
 * honest while the editor is open.
 */
export function RecipeSection({
  typeId,
  defaultReferenceWeight,
  open,
  onToggle,
  onDirtyChange,
}: {
  typeId: number;
  defaultReferenceWeight: number | null;
  open: boolean;
  onToggle: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useT();
  const [state, setState] = useState({ editing: false, ingredients: 0 });

  useEffect(() => onDirtyChange(state.editing), [state.editing, onDirtyChange]);

  return (
    <SectionCard
      title={t('settings.recipe')}
      summary={
        state.ingredients > 0
          ? `${state.ingredients} ${t('settings.ingredients_count')}`
          : t('settings.no_recipe')
      }
      open={open}
      onToggle={onToggle}
      dirty={state.editing}
    >
      <RecipeEditor
        breadTypeId={typeId}
        defaultReferenceWeight={defaultReferenceWeight}
        onStateChange={setState}
      />
    </SectionCard>
  );
}
