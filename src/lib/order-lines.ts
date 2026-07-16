import { db } from '@/db';
import {
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadAdditions,
  breadTypeAdditions,
  groups,
} from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { WriteLine } from './order-pricing';

/** The line shape both order create (POST) and edit (PATCH) accept. */
export type OrderLineInput = {
  breadTypeId: number;
  breadSizeId: number;
  quantity: number;
  breadAdditionIds?: number[];
  additionsCharged?: boolean | null; // per-line override; null/undefined = inherit order default
};

/** A fully-resolved, validated, priced order line — enough to write it AND label it. */
export type ResolvedOrderLine = {
  breadTypeId: number;
  breadTypeName: string;
  breadSizeId: number;
  breadSizeName: string;
  weightGrams: number | null;
  quantity: number;
  pricePerUnit: string; // base + surcharge (only when this line charges additions)
  additionsCharged: boolean | null; // stored per-line value (input echo)
  breadAdditionIds: number[];
  additionNames: string[];
  writeLine: WriteLine; // for the bulk-pricing engine (base unit price, no surcharge)
};

export type ResolveLinesResult =
  | { ok: true; surcharge: number; lines: ResolvedOrderLine[] }
  | { ok: false; status: number; error: string };

/**
 * Resolve + validate + price a set of order lines against a group's catalog —
 * THE single write-path for order lines, shared by create (POST) and edit
 * (PATCH). Validates each (type, size) pair and every addition (exists + enabled
 * on the type), computes the per-unit price (base = priceOverride ?? size.price,
 * plus the additions surcharge only when the line charges it), and returns both
 * the engine WriteLine and the display names, so no caller re-derives prices or
 * re-fetches names. Returns a typed error instead of throwing so each caller
 * renders it its own way; callers MUST validate before mutating anything.
 */
export async function resolveAndPriceOrderLines(
  groupId: number,
  items: OrderLineInput[],
  chargeAdd: boolean
): Promise<ResolveLinesResult> {
  const typeIds = items.map((i) => i.breadTypeId);
  const sizeIds = items.map((i) => i.breadSizeId);

  const typeRows = await db
    .select({ id: breadTypes.id, name: breadTypes.name })
    .from(breadTypes)
    .where(eq(breadTypes.groupId, groupId));
  const typeMap = new Map(typeRows.map((t) => [t.id, t]));

  const sizeRows = await db
    .select()
    .from(breadSizes)
    .where(and(inArray(breadSizes.id, sizeIds), eq(breadSizes.groupId, groupId)));
  const sizeMap = new Map(sizeRows.map((s) => [s.id, s]));

  const links = await db
    .select()
    .from(breadTypeSizes)
    .where(and(inArray(breadTypeSizes.breadTypeId, typeIds), inArray(breadTypeSizes.breadSizeId, sizeIds)));
  const linkMap = new Map(links.map((l) => [`${l.breadTypeId}:${l.breadSizeId}`, l]));

  const allAdditionIds = items.flatMap((i) => i.breadAdditionIds ?? []);
  const additionRows = allAdditionIds.length
    ? await db
        .select({ id: breadAdditions.id, name: breadAdditions.name, sortOrder: breadAdditions.sortOrder })
        .from(breadAdditions)
        .where(and(inArray(breadAdditions.id, allAdditionIds), eq(breadAdditions.groupId, groupId)))
    : [];
  const additionMap = new Map(additionRows.map((a) => [a.id, a]));

  const additionTypeLinks = allAdditionIds.length
    ? await db
        .select()
        .from(breadTypeAdditions)
        .where(
          and(
            inArray(breadTypeAdditions.breadTypeId, typeIds),
            inArray(breadTypeAdditions.breadAdditionId, allAdditionIds)
          )
        )
    : [];
  const additionLinkSet = new Set(additionTypeLinks.map((l) => `${l.breadTypeId}:${l.breadAdditionId}`));

  const [grp] = await db
    .select({ surcharge: groups.additionsSurcharge })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  const surcharge = Number(grp?.surcharge ?? 0);

  const lines: ResolvedOrderLine[] = [];
  for (const item of items) {
    const type = typeMap.get(item.breadTypeId);
    if (!type) return { ok: false, status: 404, error: `Bread type ${item.breadTypeId} not found` };
    const size = sizeMap.get(item.breadSizeId);
    if (!size) return { ok: false, status: 404, error: `Bread size ${item.breadSizeId} not found` };
    const link = linkMap.get(`${item.breadTypeId}:${item.breadSizeId}`);
    if (!link) {
      return { ok: false, status: 400, error: `Size ${item.breadSizeId} not enabled for type ${item.breadTypeId}` };
    }
    const breadAdditionIds = item.breadAdditionIds ?? [];
    const lineAdditions: { name: string; sortOrder: number }[] = [];
    for (const addId of breadAdditionIds) {
      const add = additionMap.get(addId);
      if (!add) return { ok: false, status: 404, error: `Bread addition ${addId} not found` };
      if (!additionLinkSet.has(`${item.breadTypeId}:${addId}`)) {
        return { ok: false, status: 400, error: `Addition ${addId} not enabled for type ${item.breadTypeId}` };
      }
      lineAdditions.push({ name: add.name, sortOrder: add.sortOrder });
    }
    // Order the display names by catalog sortOrder, matching every other label
    // surface (read/notification paths order additions this way).
    const additionNames = lineAdditions.sort((a, b) => a.sortOrder - b.sortOrder).map((a) => a.name);

    const base = Number(link.priceOverride ?? size.price);
    const hasAdditions = breadAdditionIds.length > 0;
    const lineCharge = item.additionsCharged ?? chargeAdd; // per-line override else order default
    const pricePerUnit = (base + (lineCharge && hasAdditions ? surcharge : 0)).toFixed(2);

    lines.push({
      breadTypeId: item.breadTypeId,
      breadTypeName: type.name,
      breadSizeId: item.breadSizeId,
      breadSizeName: size.name,
      weightGrams: size.weightGrams,
      quantity: item.quantity,
      pricePerUnit,
      additionsCharged: item.additionsCharged ?? null,
      breadAdditionIds,
      additionNames,
      writeLine: {
        breadTypeId: item.breadTypeId,
        breadSizeId: item.breadSizeId,
        quantity: item.quantity,
        unitPrice: base,
        hasAdditions,
        chargeAdditions: lineCharge,
      },
    });
  }

  return { ok: true, surcharge, lines };
}
