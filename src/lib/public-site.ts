import { revalidatePath } from 'next/cache';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  groups,
  breadTypes,
  breadSizes,
  breadTypeSizes,
  bakeryProfile,
  mediaAssets,
  type SectionConfig,
} from '@/db/schema';
import { resolveBadge, type ResolvedBadge } from './badges';

// ---- View-model ----

export type PublicImage = {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
};

export type PublicSize = {
  id: number;
  name: string;
  weightGrams: number | null;
  price: string; // formatted, no currency symbol
  badge: ResolvedBadge | null;
};

export type PublicBread = {
  id: number;
  name: string;
  description: string | null;
  badge: ResolvedBadge | null;
  image: PublicImage | null;
  sizes: PublicSize[];
};

export type PublicProfile = {
  displayName: string;
  tagline: string | null;
  heroHeadline: string | null;
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
};

export type PublicSite = {
  profile: PublicProfile;
  sections: SectionConfig[];
  catalog: PublicBread[];
  gallery: PublicImage[];
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

function formatPrice(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
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
    .select({ id: groups.id, name: groups.name })
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

  const sizesByType = new Map<number, typeof sizeLinks>();
  for (const link of sizeLinks) {
    const arr = sizesByType.get(link.breadTypeId) ?? [];
    arr.push(link);
    sizesByType.set(link.breadTypeId, arr);
  }

  const catalog: PublicBread[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    badge: resolveBadge(t.badgeType, t.badgeLabel),
    image: toImage(imageById.get(t.imageId ?? -1)),
    sizes: (sizesByType.get(t.id) ?? []).map((l) => ({
      id: l.breadSizeId,
      name: l.name,
      weightGrams: l.weightGrams,
      price: formatPrice(l.priceOverride ?? l.price),
      badge: resolveBadge(l.badgeType, l.badgeLabel),
    })),
  }));

  const publicProfile: PublicProfile = {
    displayName: profile.displayName ?? group.name,
    tagline: profile.tagline,
    heroHeadline: profile.heroHeadline,
    story: profile.story,
    trustItems: profile.trustItems ?? [],
    whatsappPhone: profile.whatsappPhone,
    contactPhone: profile.contactPhone,
    instagram: profile.instagram,
    address: profile.address,
    mapUrl: profile.mapUrl,
    bakeDays: profile.bakeDays,
    pickupArea: profile.pickupArea,
    heroImage: toImage(imageById.get(profile.heroImageId ?? -1)),
  };

  return {
    profile: publicProfile,
    sections: normalizeSections(profile.sections),
    catalog,
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
export function getPublicSite(groupId: number): Promise<PublicSite | null> {
  return assembleSite(groupId);
}
