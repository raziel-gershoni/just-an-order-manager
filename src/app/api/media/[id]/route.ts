import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { mediaAssets } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { deleteImage } from '@/lib/media';
import { revalidatePublicSite } from '@/lib/public-site';

function ownerOnly(role: string | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

function getId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  return Number(parts[parts.length - 1]);
}

const updateSchema = z.object({
  alt: z.string().max(255).nullable().optional(),
  showInGallery: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!ownerOnly(membership?.role)) return errorResponse('Forbidden', 403);

  const id = getId(request.url);
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [asset] = await db
    .update(mediaAssets)
    .set(parsed.data)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.groupId, groupId)))
    .returning();
  if (!asset) return errorResponse('Not found', 404);

  revalidatePublicSite(groupId);
  return jsonResponse({ asset });
});

export const DELETE = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!ownerOnly(membership?.role)) return errorResponse('Forbidden', 403);

  const id = getId(request.url);

  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.groupId, groupId)))
    .limit(1);
  if (!asset) return errorResponse('Not found', 404);

  // FK references (hero/logo/bread image) are ON DELETE SET NULL, so deleting
  // the row clears them automatically. Remove the blob too.
  await deleteImage(asset.blobPathname);
  await db.delete(mediaAssets).where(eq(mediaAssets.id, id));

  revalidatePublicSite(groupId);
  return jsonResponse({ success: true });
});
