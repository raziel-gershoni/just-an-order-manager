import { eq, and, asc, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  groups,
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadAdditions,
  bakeryProfile,
} from '@/db/schema';

function num(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A compact, Hebrew-keyed snapshot of the bakery's pricelist — bread types
 * with sizes/prices, plus additions surcharge, delivery terms and basic
 * bakery info. Built for feeding an LLM (e.g. to render a pricelist image),
 * so keys are in Hebrew and prices are plain numbers. Owner/manager only;
 * reflects the live catalog regardless of whether the public site is published.
 *
 * Hebrew keys are quoted *string* literals (not bare identifiers) so SWC
 * doesn't flag them as non-ASCII identifiers.
 */
export async function buildCatalogExport(groupId: number): Promise<Record<string, unknown> | null> {
  const [group] = await db
    .select({
      name: groups.name,
      additionsSurcharge: groups.additionsSurcharge,
      deliveryEnabled: groups.deliveryEnabled,
      deliveryHomeCity: groups.deliveryHomeCity,
      deliveryFee: groups.deliveryFee,
      deliveryFreeOver: groups.deliveryFreeOver,
      deliveryCities: groups.deliveryCities,
    })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) return null;

  const [profile] = await db
    .select({
      tagline: bakeryProfile.tagline,
      whatsappPhone: bakeryProfile.whatsappPhone,
      contactPhone: bakeryProfile.contactPhone,
      bakeDays: bakeryProfile.bakeDays,
    })
    .from(bakeryProfile)
    .where(eq(bakeryProfile.groupId, groupId))
    .limit(1);

  const types = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.groupId, groupId), eq(breadTypes.isActive, true)))
    .orderBy(asc(breadTypes.sortOrder));
  const typeIds = types.map((t) => t.id);

  const sizeLinks = typeIds.length
    ? await db
        .select({
          breadTypeId: breadTypeSizes.breadTypeId,
          name: breadSizes.name,
          price: breadSizes.price,
          priceOverride: breadTypeSizes.priceOverride,
          sortOrder: breadTypeSizes.sortOrder,
        })
        .from(breadTypeSizes)
        .innerJoin(breadSizes, eq(breadTypeSizes.breadSizeId, breadSizes.id))
        .where(and(inArray(breadTypeSizes.breadTypeId, typeIds), eq(breadSizes.isActive, true)))
        .orderBy(asc(breadTypeSizes.sortOrder))
    : [];

  const allAdditions = await db
    .select({ name: breadAdditions.name })
    .from(breadAdditions)
    .where(and(eq(breadAdditions.groupId, groupId), eq(breadAdditions.isActive, true)))
    .orderBy(asc(breadAdditions.sortOrder));

  const sizesByType = new Map<number, { name: string; price: number }[]>();
  for (const l of sizeLinks) {
    const arr = sizesByType.get(l.breadTypeId) ?? [];
    arr.push({ name: l.name, price: num(l.priceOverride ?? l.price) });
    sizesByType.set(l.breadTypeId, arr);
  }

  const breads = types.map((t) => {
    const sizes = (sizesByType.get(t.id) ?? [])
      .slice()
      .sort((a, b) => a.price - b.price)
      .map((s) => ({ 'שם': s.name, 'מחיר': s.price }));
    const bread: Record<string, unknown> = { 'שם': t.name };
    if (t.description) bread['תיאור'] = t.description;
    bread['גדלים'] = sizes;
    return bread;
  });

  const out: Record<string, unknown> = { 'מאפייה': group.name };
  if (profile?.tagline) out['סלוגן'] = profile.tagline;
  if (profile?.bakeDays) out['ימי_אפייה'] = profile.bakeDays;
  const phone = profile?.whatsappPhone || profile?.contactPhone;
  if (phone) out['טלפון_הזמנות'] = phone;
  if (group.deliveryHomeCity) out['עיר'] = group.deliveryHomeCity;
  out['מטבע'] = '₪';

  out['תוספות'] = {
    // Flat surcharge for adding toppings (any number), not per topping.
    'מחיר_עבור_תוספות': num(group.additionsSurcharge),
    'אפשרויות': allAdditions.map((a) => a.name),
  };

  out['משלוח'] = group.deliveryEnabled
    ? {
        'פעיל': true,
        'עיר_חינם': group.deliveryHomeCity ?? null,
        'מחיר_לערים_מהרשימה': num(group.deliveryFee),
        'ערים_בתשלום': group.deliveryCities ?? [],
        ...(group.deliveryFreeOver != null ? { 'חינם_מעל': num(group.deliveryFreeOver) } : {}),
      }
    : { 'פעיל': false };

  out['סוגי_לחם'] = breads;

  return out;
}
