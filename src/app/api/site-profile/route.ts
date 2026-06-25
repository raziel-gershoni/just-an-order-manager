import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { bakeryProfile, groups } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import {
  DEFAULT_SECTIONS,
  normalizeSections,
  revalidatePublicSite,
} from '@/lib/public-site';

function ownerOnly(role: string | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export const GET = withGroup(async (_request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!ownerOnly(membership?.role)) {
    return errorResponse('Forbidden', 403);
  }

  const [row] = await db
    .select()
    .from(bakeryProfile)
    .where(eq(bakeryProfile.groupId, groupId))
    .limit(1);

  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  if (row) {
    return jsonResponse({
      profile: { ...row, sections: normalizeSections(row.sections) },
      groupName: group?.name ?? '',
    });
  }

  // No row yet — hand back a default shape for the editor to populate.
  return jsonResponse({
    profile: {
      groupId,
      isPublished: false,
      displayName: group?.name ?? '',
      tagline: null,
      heroHeadline: null,
      eyebrow: null,
      story: null,
      trustItems: [],
      whatsappPhone: null,
      contactPhone: null,
      instagram: null,
      address: null,
      mapUrl: null,
      bakeDays: null,
      pickupArea: null,
      heroImageId: null,
      logoImageId: null,
      sections: DEFAULT_SECTIONS,
    },
    groupName: group?.name ?? '',
  });
});

const nullableStr = (max: number) => z.string().max(max).nullable().optional();

const patchSchema = z.object({
  isPublished: z.boolean().optional(),
  displayName: nullableStr(255),
  tagline: nullableStr(255),
  heroHeadline: nullableStr(255),
  eyebrow: nullableStr(120),
  story: nullableStr(5000),
  trustItems: z.array(z.string().max(60)).max(8).optional(),
  whatsappPhone: nullableStr(32),
  contactPhone: nullableStr(32),
  instagram: nullableStr(64),
  address: nullableStr(255),
  mapUrl: nullableStr(1000),
  bakeDays: nullableStr(64),
  pickupArea: nullableStr(120),
  heroImageId: z.number().int().nullable().optional(),
  logoImageId: z.number().int().nullable().optional(),
  sections: z
    .array(z.object({ key: z.string(), visible: z.boolean() }))
    .optional(),
});

export const PATCH = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!ownerOnly(membership?.role)) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  // Keep only provided keys; normalize sections.
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    set[key] = key === 'sections' ? normalizeSections(value as never) : value;
  }
  set.updatedAt = new Date();

  const [profile] = await db
    .insert(bakeryProfile)
    .values({ groupId, ...set })
    .onConflictDoUpdate({ target: bakeryProfile.groupId, set })
    .returning();

  revalidatePublicSite(groupId);

  return jsonResponse({
    profile: { ...profile, sections: normalizeSections(profile.sections) },
  });
});
