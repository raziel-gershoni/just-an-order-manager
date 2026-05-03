/**
 * Format a single order line for display: "{quantity} {typeName}" or
 * "{quantity} {typeName} {sizeLabel}" when a size is set.
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
 * Join multiple item lines into a comma-separated summary.
 */
export function formatItemsSummary(
  items: { quantity: number; breadTypeName: string; sizeName?: string | null }[]
): string {
  return items
    .map((i) => formatItemLine(i.quantity, i.breadTypeName, i.sizeName))
    .join(', ');
}
