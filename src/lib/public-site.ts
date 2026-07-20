import { cache } from 'react';
import { revalidatePath } from 'next/cache';
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
  mediaAssets,
  type SectionConfig,
} from '@/db/schema';
import { resolveBadge, type ResolvedBadge } from './badges';
import { loadGroupTiers } from './order-pricing';

// ---- View-model ----

export type PublicImage = {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
};

/** A public-facing bulk deal for a size: "buy `minQty` for `packPrice`", with
 *  the savings pre-computed against the single price (all money formatted). Only
 *  tiers that actually beat `minQty × single` are surfaced. */
export type PublicDeal = {
  minQty: number;
  packPrice: string; // total for the pack, formatted
  eachPrice: string; // effective per-unit price at this tier, formatted
  saveAmount: string; // shekels saved vs buying singles, formatted
  savePct: number; // rounded percent off
};

export type PublicSize = {
  id: number;
  name: string;
  weightGrams: number | null;
  price: string; // formatted, no currency symbol
  badge: ResolvedBadge | null;
  deals: PublicDeal[]; // bulk tiers cheaper than singles, ascending by minQty
};

export type PublicBread = {
  id: number;
  name: string;
  description: string | null;
  badge: ResolvedBadge | null;
  image: PublicImage | null;
  sizes: PublicSize[];
  additions: string[];
};

export type PublicProfile = {
  displayName: string;
  tagline: string | null;
  heroHeadline: string | null;
  eyebrow: string | null;
  story: string | null;
  trustItems: string[];
  whatsappPhone: string | null;
  contactPhone: string | null;
  instagram: string | null;
  address: string | null;
  mapUrl: string | null;
  bakeDays: string | null;
  pickupArea: string | null;
  heroImage: PublicImage | null;
  logoUrl: string | null;
  delivery: { homeCity: string | null; fee: number; freeOver: number | null } | null;
};

export type PublicSite = {
  profile: PublicProfile;
  sections: SectionConfig[];
  catalog: PublicBread[];
  gallery: PublicImage[];
  additionsSurcharge: number;
};

// ---- Section defaults (used until the owner reorders) ----

export const SECTION_KEYS = [
  'hero',
  'gallery',
  'pricelist',
  'story',
  'details',
  'cta',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const DEFAULT_SECTIONS: SectionConfig[] = SECTION_KEYS.map((key) => ({
  key,
  visible: true,
}));

/** Keep only known keys, in the owner's order, then append any missing keys. */
export function normalizeSections(
  raw: SectionConfig[] | null | undefined
): SectionConfig[] {
  const known = new Set<string>(SECTION_KEYS);
  const seen = new Set<string>();
  const out: SectionConfig[] = [];
  for (const s of raw ?? []) {
    if (known.has(s.key) && !seen.has(s.key)) {
      out.push({ key: s.key, visible: s.visible !== false });
      seen.add(s.key);
    }
  }
  for (const key of SECTION_KEYS) {
    if (!seen.has(key)) out.push({ key, visible: true });
  }
  return out;
}

// ---- On-demand revalidation ----

// The public site lives at "/" (single group). Purge that path when the owner
// edits the profile, catalog, badges, or media. (Per-slug paths later.)
export function revalidatePublicSite(_groupId: number): void {
  revalidatePath('/');
}

// ---- Link builders ----

export function buildWhatsAppLink(
  phone: string | null | undefined,
  text?: string
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  // Israeli local "0XX…" → international "972XX…".
  const intl = digits.startsWith('0') ? '972' + digits.slice(1) : digits;
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${intl}${q}`;
}

export function buildTelegramLink(
  botUsername: string | null | undefined
): string | null {
  if (!botUsername) return null;
  const u = botUsername.replace(/^@/, '').trim();
  return u ? `https://t.me/${u}` : null;
}

// ---- Helpers ----

function formatPrice(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Turn a (type, size)'s raw tier map into public deals, keeping only tiers that
 *  actually undercut buying `minQty` singles and pre-computing the savings. */
function buildDeals(
  single: number,
  tierPrices: Record<number, number>
): PublicDeal[] {
  if (!(single > 0)) return [];
  return Object.entries(tierPrices)
    .map(([q, p]) => ({ minQty: Number(q), pack: Number(p) }))
    .filter(({ minQty, pack }) => minQty >= 2 && pack > 0 && pack < single * minQty)
    .sort((a, b) => a.minQty - b.minQty)
    .map(({ minQty, pack }) => {
      const full = single * minQty;
      const save = full - pack;
      return {
        minQty,
        packPrice: formatPrice(pack),
        eachPrice: formatPrice(pack / minQty),
        saveAmount: formatPrice(save),
        savePct: Math.round((save / full) * 100),
      };
    });
}

function toImage(
  row: { blobUrl: string; alt: string | null; width: number | null; height: number | null } | undefined
): PublicImage | null {
  if (!row) return null;
  return { url: row.blobUrl, alt: row.alt, width: row.width, height: row.height };
}

// ---- Assembly ----

async function assembleSite(groupId: number): Promise<PublicSite | null> {
  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      logoUrl: groups.logoUrl,
      additionsSurcharge: groups.additionsSurcharge,
      deliveryEnabled: groups.deliveryEnabled,
      deliveryHomeCity: groups.deliveryHomeCity,
      deliveryFee: groups.deliveryFee,
      deliveryFreeOver: groups.deliveryFreeOver,
    })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) return null;

  const [profile] = await db
    .select()
    .from(bakeryProfile)
    .where(eq(bakeryProfile.groupId, groupId))
    .limit(1);

  // The public site is dark until the owner publishes it.
  if (!profile || !profile.isPublished) return null;

  // Active types, ordered.
  const types = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.groupId, groupId), eq(breadTypes.isActive, true)))
    .orderBy(asc(breadTypes.sortOrder));
  const typeIds = types.map((t) => t.id);

  // Active sizes per type (+ per-size badge).
  const sizeLinks = typeIds.length
    ? await db
        .select({
          breadTypeId: breadTypeSizes.breadTypeId,
          breadSizeId: breadSizes.id,
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
        .where(
          and(
            inArray(breadTypeSizes.breadTypeId, typeIds),
            eq(breadSizes.isActive, true)
          )
        )
        .orderBy(asc(breadTypeSizes.sortOrder))
    : [];

  // Resolve all referenced images (hero + per-type) plus the gallery.
  const imageIds = [
    profile.heroImageId,
    ...types.map((t) => t.imageId),
  ].filter((v): v is number => typeof v === 'number');

  const imageRows = imageIds.length
    ? await db
        .select()
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, Array.from(new Set(imageIds))))
    : [];
  const imageById = new Map(imageRows.map((r) => [r.id, r]));

  const galleryRows = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.groupId, groupId),
        eq(mediaAssets.showInGallery, true)
      )
    )
    .orderBy(asc(mediaAssets.sortOrder));

  // Enabled additions per type (names only, ordered).
  const additionLinks = typeIds.length
    ? await db
        .select({
          breadTypeId: breadTypeAdditions.breadTypeId,
          name: breadAdditions.name,
          sortOrder: breadTypeAdditions.sortOrder,
        })
        .from(breadTypeAdditions)
        .innerJoin(breadAdditions, eq(breadTypeAdditions.breadAdditionId, breadAdditions.id))
        .where(
          and(
            inArray(breadTypeAdditions.breadTypeId, typeIds),
            eq(breadAdditions.isActive, true)
          )
        )
        .orderBy(asc(breadTypeAdditions.sortOrder))
    : [];
  const additionsByType = new Map<number, string[]>();
  for (const a of additionLinks) {
    const arr = additionsByType.get(a.breadTypeId) ?? [];
    arr.push(a.name);
    additionsByType.set(a.breadTypeId, arr);
  }

  const sizesByType = new Map<number, typeof sizeLinks>();
  for (const link of sizeLinks) {
    const arr = sizesByType.get(link.breadTypeId) ?? [];
    arr.push(link);
    sizesByType.set(link.breadTypeId, arr);
  }

  // Bulk tiers, indexed the same way the order engine reads them, so public
  // deals derive from the one tier source of truth.
  const groupTiers = await loadGroupTiers(groupId);

  const catalog: PublicBread[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    badge: resolveBadge(t.badgeType, t.badgeLabel, t.badgeIcon),
    image: toImage(imageById.get(t.imageId ?? -1)),
    // Sizes sorted by effective price, low → high.
    sizes: (sizesByType.get(t.id) ?? [])
      .map((l) => {
        const single = Number(l.priceOverride ?? l.price);
        return {
          id: l.breadSizeId,
          name: l.name,
          weightGrams: l.weightGrams,
          price: formatPrice(l.priceOverride ?? l.price),
          badge: resolveBadge(l.badgeType, l.badgeLabel, l.badgeIcon),
          deals: buildDeals(single, groupTiers.tierPricesFor(t.id, l.breadSizeId)),
        };
      })
      .sort((a, b) => Number(a.price) - Number(b.price)),
    additions: additionsByType.get(t.id) ?? [],
  }));

  const publicProfile: PublicProfile = {
    // The bakery name has a single home: group settings.
    displayName: group.name,
    tagline: profile.tagline,
    heroHeadline: profile.heroHeadline,
    eyebrow: profile.eyebrow,
    story: profile.story,
    trustItems: profile.trustItems ?? [],
    whatsappPhone: profile.whatsappPhone,
    contactPhone: profile.contactPhone,
    instagram: profile.instagram,
    address: profile.address,
    mapUrl: profile.mapUrl,
    bakeDays: profile.bakeDays,
    // Pickup/origin city has a single home: the delivery home city.
    pickupArea: group.deliveryHomeCity,
    heroImage: toImage(imageById.get(profile.heroImageId ?? -1)),
    logoUrl: group.logoUrl,
    delivery: group.deliveryEnabled
      ? {
          homeCity: group.deliveryHomeCity,
          fee: Number(group.deliveryFee || 0),
          freeOver: group.deliveryFreeOver != null ? Number(group.deliveryFreeOver) : null,
        }
      : null,
  };

  return {
    profile: publicProfile,
    sections: normalizeSections(profile.sections),
    catalog,
    additionsSurcharge: Number(group.additionsSurcharge || 0),
    gallery: galleryRows.map(
      (r): PublicImage => ({
        url: r.blobUrl,
        alt: r.alt,
        width: r.width,
        height: r.height,
      })
    ),
  };
}

/** Public-site view-model for a group. Null if the group doesn't exist or the
 *  site isn't published. Cached at the route level via `export const revalidate`
 *  and purged on owner edits via {@link revalidatePublicSite}. */
export async function getPublicSite(
  groupId: number
): Promise<PublicSite | null> {
  try {
    return await assembleSite(groupId);
  } catch (err) {
    // No DB at build time / transient error → render the "coming soon" state
    // rather than crashing the route. ISR retries on the next revalidation.
    console.error('[public-site] assemble failed:', err);
    return null;
  }
}

/** The group whose site is served at "/". */
export function publicGroupId(): number {
  return Number(process.env.PUBLIC_SITE_GROUP_ID) || 0;
}

/** Request-deduped variant: the layout (metadata) and the page both read it. */
export const getPublicSiteRequest = cache(getPublicSite);
