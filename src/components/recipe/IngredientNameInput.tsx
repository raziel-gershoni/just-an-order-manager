'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { IngredientKind } from '@/lib/recipe';

/**
 * A name field that offers what the bakery already calls things. A datalist
 * rather than a select: across fifteen breads you retype קמח / מים / מלח /
 * מחמצת constantly, but a new ingredient must never be harder to enter than an
 * old one.
 *
 * Suggestions are filtered to the row's own kind — a flour row wants flours.
 */
export function IngredientNameInput({
  value,
  onChange,
  kind,
  namesByKind,
  placeholder,
  duplicate,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  kind: IngredientKind;
  namesByKind: Record<IngredientKind, string[]>;
  placeholder?: string;
  duplicate?: boolean;
  className?: string;
}) {
  const listId = useId();
  const suggestions = namesByKind[kind] ?? [];

  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={suggestions.length > 0 ? listId : undefined}
        aria-invalid={duplicate || undefined}
        // Input spreads className onto its wrapper, not the field, so the
        // invalid border has to reach through.
        className={cn('text-sm', duplicate && '[&_input]:border-destructive', className)}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      )}
    </>
  );
}
