import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groups } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { uploadImage, deleteImage } from '@/lib/media';
import { revalidatePublicSite } from '@/lib/public-site';

function getGroupId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const gIdx = parts.indexOf('groups');
  return Number(parts[gIdx + 1]);
}

function canManage(role: string | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export const POST = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (!canManage(membership.role)) return errorResponse('Forbidden', 403);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return errorResponse('No file');
  if (!file.type.startsWith('image/')) return errorResponse('Not an image');
  if (file.size > MAX_BYTES) return errorResponse('Image too large (max 8MB)');

  // Remove the previous logo blob, if any.
  const [existing] = await db
    .select({ logoPathname: groups.logoPathname })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (existing?.logoPathname) await deleteImage(existing.logoPathname);

  const { url, pathname } = await uploadImage(file, groupId);

  const [updated] = await db
    .update(groups)
    .set({ logoUrl: url, logoPathname: pathname })
    .where(eq(groups.id, groupId))
    .returning({ logoUrl: groups.logoUrl });

  revalidatePublicSite(groupId);
  return jsonResponse({ logoUrl: updated.logoUrl }, 201);
});

export const DELETE = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (!canManage(membership.role)) return errorResponse('Forbidden', 403);

  const [existing] = await db
    .select({ logoPathname: groups.logoPathname })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (existing?.logoPathname) await deleteImage(existing.logoPathname);

  await db
    .update(groups)
    .set({ logoUrl: null, logoPathname: null })
    .where(eq(groups.id, groupId));

  revalidatePublicSite(groupId);
  return jsonResponse({ success: true });
});
