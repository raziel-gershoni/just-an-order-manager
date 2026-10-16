// Pure, client-safe. One fingerprint for "is this the same basket?", shared by
// the order form, the edit route and the next-occurrence change, so the screen
// and the server always agree on whether a basket gets re-priced.

export type FingerprintLine = {
  breadTypeId: number;
  breadSizeId: number | null;
  quantity: number;
  breadAdditionIds?: number[];
  additionsCharged?: boolean | null;
};

/**
 * The pricing inputs of a basket, order-independent.
 *
 * It has to be the same shape everywhere, not merely a comparison:
 * JSON.stringify is sensitive to line order, to the order of the addition ids
 * (tapping a chip off and back on appends it to the end) and to which keys
 * happen to be present, so it called an untouched basket "changed" and priced
 * the delivery fee against today's catalog while the server kept the frozen one.
 */
export function basketFingerprint(lines: FingerprintLine[]): string {
  return lines
    .map(
      (i) =>
        `${i.breadTypeId}:${i.breadSizeId}:${i.quantity}:${[...(i.breadAdditionIds ?? [])]
          .sort((a, b) => a - b)
          .join(',')}:${i.additionsCharged == null ? 'n' : i.additionsCharged ? '1' : '0'}`
    )
    .sort()
    .join('|');
}

/** The basket plus both pricing switches — everything the frozen goods depend on. */
export function pricingKey(lines: FingerprintLine[], dealsEnabled: boolean, additionsCharged: boolean): string {
  return `${basketFingerprint(lines)}#${dealsEnabled ? 1 : 0}${additionsCharged ? 1 : 0}`;
}
