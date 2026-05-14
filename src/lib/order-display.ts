/**
 * Customer-facing line — name only, no weight.
 * "{quantity} {typeName}" or "{quantity} {typeName} {sizeLabel}" or
 * "{quantity} {typeName} {sizeLabel} (עם addition, addition)"
 */
export function formatItemLine(
  quantity: number,
  typeName: string,
  sizeLabel?: string | null,
  additions?: string[] | null
): string {
  const base = sizeLabel ? `${typeName} ${sizeLabel}` : typeName;
  const withAdds = additions && additions.length
    ? `${base} (עם ${additions.join(', ')})`
    : base;
  return `${quantity} ${withAdds}`;
}

/**
 * Staff-facing line — includes the integer weight when set, useful for
 * baker production planning. Customer-facing channels MUST NOT use this.
 * "{quantity} {typeName} {sizeLabel} ({weight}g) (עם addition, addition)"
 */
export function formatItemLineForStaff(
  quantity: number,
  typeName: string,
  sizeLabel?: string | null,
  weightGrams?: number | null,
  additions?: string[] | null
): string {
  let base = sizeLabel ? `${typeName} ${sizeLabel}` : typeName;
  if (weightGrams != null) base = `${base} (${weightGrams}g)`;
  if (additions && additions.length) base = `${base} (עם ${additions.join(', ')})`;
  return `${quantity} ${base}`;
}
