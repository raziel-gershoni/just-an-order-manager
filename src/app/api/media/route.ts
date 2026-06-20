import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { mediaAssets } from '@/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { uploadImage } from '@/lib/media';
import { revalidatePublicSite } from '@/lib/public-site';

function ownerOnly(role: string | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export const GET = withGroup(async (_request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!ownerOnly(membership?.role)) return errorResponse('Forbidden', 403);

  const assets = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.groupId, groupId))
    .orderBy(asc(mediaAssets.sortOrder), asc(mediaAssets.id));
  return jsonResponse({ assets });
});

export const POST = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!ownerOnly(membership?.role)) return errorResponse('Forbidden', 403);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return errorResponse('No file');
  if (!file.type.startsWith('image/')) return errorResponse('Not an image');
  if (file.size > MAX_BYTES) return errorResponse('Image too large (max 8MB)');

  const width = Number(form?.get('width')) || null;
  const height = Number(form?.get('height')) || null;
  const alt = (form?.get('alt') as string | null)?.slice(0, 255) || null;

  const { url, pathname } = await uploadImage(file, groupId);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${mediaAssets.sortOrder}), -1)` })
    .from(mediaAssets)
    .where(eq(mediaAssets.groupId, groupId));

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      groupId,
      blobUrl: url,
      blobPathname: pathname,
      alt,
      width,
      height,
      sortOrder: maxSort + 1,
    })
    .returning();

  revalidatePublicSite(groupId);
  return jsonResponse({ asset }, 201);
});
