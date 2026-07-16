/**
 * Customer-facing label — no quantity, no weight.
 * "{typeName}" or "{typeName} {sizeLabel}" or "{typeName} {sizeLabel} (עם addition, addition)"
 */
export function formatItemLabel(
  typeName: string,
  sizeLabel?: string | null,
  additions?: string[] | null
): string {
  const base = sizeLabel ? `${typeName} ${sizeLabel}` : typeName;
  return additions && additions.length ? `${base} (עם ${additions.join(', ')})` : base;
}

/** Customer-facing line — "{quantity} {label}", name only, no weight. */
export function formatItemLine(
  quantity: number,
  typeName: string,
  sizeLabel?: string | null,
  additions?: string[] | null
): string {
  return `${quantity} ${formatItemLabel(typeName, sizeLabel, additions)}`;
}

/**
 * Staff-facing label — no quantity, includes the integer weight when set (useful
 * for baker production planning). Customer-facing channels MUST NOT use this.
 * "{typeName} {sizeLabel} ({weight}g) (עם addition, addition)"
 */
export function formatStaffItemLabel(
  typeName: string,
  sizeLabel?: string | null,
  weightGrams?: number | null,
  additions?: string[] | null
): string {
  let base = sizeLabel ? `${typeName} ${sizeLabel}` : typeName;
  if (weightGrams != null) base = `${base} (${weightGrams}g)`;
  if (additions && additions.length) base = `${base} (עם ${additions.join(', ')})`;
  return base;
}

/** Staff-facing line — "{quantity} {staff label}". */
export function formatItemLineForStaff(
  quantity: number,
  typeName: string,
  sizeLabel?: string | null,
  weightGrams?: number | null,
  additions?: string[] | null
): string {
  return `${quantity} ${formatStaffItemLabel(typeName, sizeLabel, weightGrams, additions)}`;
}
