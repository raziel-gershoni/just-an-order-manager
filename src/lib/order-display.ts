/**
 * Customer-facing line — name only, no weight.
 * "{quantity} {typeName}" or "{quantity} {typeName} {sizeLabel}"
 */
export function formatItemLine(
  quantity: number,
  typeName: string,
  sizeLabel?: string | null
): string {
  const name = sizeLabel ? `${typeName} ${sizeLabel}` : typeName;
  return `${quantity} ${name}`;
}

/**
 * Staff-facing line — includes the integer weight when set, useful for
 * baker production planning. Customer-facing channels MUST NOT use this.
 * "{quantity} {typeName} {sizeLabel} ({weight}g)"
 */
export function formatItemLineForStaff(
  quantity: number,
  typeName: string,
  sizeLabel?: string | null,
  weightGrams?: number | null
): string {
  const base = formatItemLine(quantity, typeName, sizeLabel);
  return weightGrams != null ? `${base} (${weightGrams}g)` : base;
}
