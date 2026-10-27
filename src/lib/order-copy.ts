/**
 * "Order again": a saved order's lines laid onto today's menu, for the new-order
 * form to start from. Only what is still sold is carried. A bread that has left
 * the menu drops out, an addition no longer offered with it is left off, and a
 * size no longer offered is cleared so the owner picks another; prices are not
 * carried at all, since the form and the server price the copy afresh.
 */

/** One line of a saved order, as GET /orders/[id] returns it. */
export interface SourceLine {
  breadTypeId: number;
  breadSizeId: number | null;
  quantity: number;
  additions?: { id: number }[];
  additionsCharged?: boolean | null;
}

/** A bread on today's menu (GET /bread-types): active, with what it is sold in. */
export interface MenuType {
  id: number;
  enabledSizes?: { id: number }[];
  enabledAdditions?: { id: number }[];
}

export interface CopiedLine {
  breadTypeId: number;
  breadSizeId: number | null;
  breadAdditionIds: number[];
  quantity: number;
  additionsCharged: boolean | null;
}

/** `dropped`: part of the old order didn't make it, and the form says so. */
export function copyLinesToMenu(
  lines: SourceLine[],
  menu: MenuType[]
): { lines: CopiedLine[]; dropped: boolean } {
  let dropped = false;
  const copied: CopiedLine[] = [];
  for (const line of lines) {
    const type = menu.find((m) => m.id === line.breadTypeId);
    if (!type) {
      dropped = true;
      continue;
    }
    const sizeOffered =
      line.breadSizeId != null && (type.enabledSizes ?? []).some((s) => s.id === line.breadSizeId);
    if (!sizeOffered) dropped = true;
    const offered = new Set((type.enabledAdditions ?? []).map((a) => a.id));
    const additionIds = (line.additions ?? []).map((a) => a.id);
    const kept = additionIds.filter((id) => offered.has(id));
    if (kept.length < additionIds.length) dropped = true;
    copied.push({
      breadTypeId: type.id,
      breadSizeId: sizeOffered ? line.breadSizeId : null,
      breadAdditionIds: kept,
      quantity: line.quantity,
      additionsCharged: line.additionsCharged ?? null,
    });
  }
  return { lines: copied, dropped };
}
