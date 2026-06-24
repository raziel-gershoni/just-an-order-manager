import { eq, and, asc, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  groups,
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadAdditions,
  breadTypeAdditions,
  bakeryProfile,
} from '@/db/schema';
import { resolveBadge } from './badges';

function num(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A compact, Hebrew-keyed snapshot of the bakery's pricelist — bread types,
 * sizes/prices, additions, delivery terms + basic bakery info. Built for
 * feeding an LLM (e.g. to render a pricelist image), so keys are in Hebrew
 * and prices are plain numbers. Owner/manager only; reflects the live catalog
 * regardless of whether the public site is published.
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
          weightGrams: breadSizes.weightGrams,
          price: breadSizes.price,
          priceOverride: breadTypeSizes.priceOverride,
          badgeType: breadTypeSizes.badgeType,
          badgeLabel: breadTypeSizes.badgeLabel,
          badgeIcon: breadTypeSizes.badgeIcon,
          sortOrder: breadTypeSizes.sortOrder,
        })
        .from(breadTypeSizes)
        .innerJoin(breadSizes, eq(breadTypeSizes.breadSizeId, breadSizes.id))
        .where(and(inArray(breadTypeSizes.breadTypeId, typeIds), eq(breadSizes.isActive, true)))
        .orderBy(asc(breadTypeSizes.sortOrder))
    : [];

  const additionLinks = typeIds.length
    ? await db
        .select({ breadTypeId: breadTypeAdditions.breadTypeId, name: breadAdditions.name })
        .from(breadTypeAdditions)
        .innerJoin(breadAdditions, eq(breadTypeAdditions.breadAdditionId, breadAdditions.id))
        .where(and(inArray(breadTypeAdditions.breadTypeId, typeIds), eq(breadAdditions.isActive, true)))
        .orderBy(asc(breadTypeAdditions.sortOrder))
    : [];

  const allAdditions = await db
    .select({ name: breadAdditions.name })
    .from(breadAdditions)
    .where(and(eq(breadAdditions.groupId, groupId), eq(breadAdditions.isActive, true)))
    .orderBy(asc(breadAdditions.sortOrder));

  const sizesByType = new Map<number, typeof sizeLinks>();
  for (const l of sizeLinks) {
    const arr = sizesByType.get(l.breadTypeId) ?? [];
    arr.push(l);
    sizesByType.set(l.breadTypeId, arr);
  }
  const addsByType = new Map<number, string[]>();
  for (const a of additionLinks) {
    const arr = addsByType.get(a.breadTypeId) ?? [];
    arr.push(a.name);
    addsByType.set(a.breadTypeId, arr);
  }

  const out: Record<string, unknown> = { מאפייה: group.name };
  if (profile?.tagline) out.סלוגן = profile.tagline;
  if (profile?.bakeDays) out.ימי_אפייה = profile.bakeDays;
  const phone = profile?.whatsappPhone || profile?.contactPhone;
  if (phone) out.טלפון_הזמנות = phone;
  if (group.deliveryHomeCity) out.עיר = group.deliveryHomeCity;
  out.מטבע = '₪';

  out.תוספות = {
    מחיר_לתוספת: num(group.additionsSurcharge),
    אפשרויות: allAdditions.map((a) => a.name),
  };

  out.משלוח = group.deliveryEnabled
    ? {
        פעיל: true,
        עיר_חינם: group.deliveryHomeCity ?? null,
        מחיר_לערים_מהרשימה: num(group.deliveryFee),
        ערים_בתשלום: group.deliveryCities ?? [],
        ...(group.deliveryFreeOver != null ? { חינם_מעל: num(group.deliveryFreeOver) } : {}),
      }
    : { פעיל: false };

  out.סוגי_לחם = types.map((t) => {
    const sizes = (sizesByType.get(t.id) ?? [])
      .map((s) => {
        const sizeBadge = resolveBadge(s.badgeType, s.badgeLabel, s.badgeIcon, 'he')?.text;
        return {
          שם: s.name,
          ...(s.weightGrams != null ? { משקל_גרם: s.weightGrams } : {}),
          מחיר: num(s.priceOverride ?? s.price),
          ...(sizeBadge ? { תווית: sizeBadge } : {}),
        };
      })
      .sort((a, b) => a.מחיר - b.מחיר);
    const typeBadge = resolveBadge(t.badgeType, t.badgeLabel, t.badgeIcon, 'he')?.text;
    const adds = addsByType.get(t.id) ?? [];
    return {
      שם: t.name,
      ...(t.description ? { תיאור: t.description } : {}),
      ...(typeBadge ? { תווית: typeBadge } : {}),
      גדלים: sizes,
      ...(adds.length ? { תוספות_זמינות: adds } : {}),
    };
  });

  return out;
}
