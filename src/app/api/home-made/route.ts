import { withGroup, jsonResponse, errorResponse, denyBakers } from '@/lib/api-utils';
import { z } from 'zod/v4';
import { homeMadeSchema, checkHomeMade, upsertHomeMade, deleteHomeMade } from '@/lib/catalog-writes';
import { loadHomeMadeCatalog } from '@/lib/ingredient-costs';

/**
 * Home-made ingredients (starters, tangzhong): defined here, in the catalogue,
 * before any recipe uses them. Owner/manager only, like the prices they derive.
 * Writes go through the same functions an approved MCP proposal uses.
 */

export const GET = withGroup(async (_request, auth, groupId) => {
  const denied = denyBakers(auth, groupId);
  if (denied) return denied;
  try {
    return jsonResponse(await loadHomeMadeCatalog(groupId));
  } catch (e) {
    console.error('[home-made] read failed', e);
    return errorResponse('Could not load the home-made ingredients', 500);
  }
});

/** `create: true` is the add form: saving over an entry that exists is then refused (409). */
const putSchema = homeMadeSchema.extend({ create: z.boolean().optional() });

export const PUT = withGroup(async (request, auth, groupId) => {
  const denied = denyBakers(auth, groupId);
  if (denied) return denied;

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);
  const { create, ...settings } = parsed.data;

  try {
    const refusal = await checkHomeMade(groupId, settings, { create });
    if (refusal) return errorResponse(refusal.error, refusal.code === 'exists' ? 409 : 400);
    const saved = await upsertHomeMade(groupId, settings);
    if (!saved.ok) return errorResponse(saved.error, saved.status);
  } catch (e) {
    console.error('[home-made] write failed', e);
    return errorResponse('Could not save the home-made ingredient', 500);
  }
  return jsonResponse({ ok: true });
});

const deleteQuery = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['starter', 'tangzhong']),
});

export const DELETE = withGroup(async (request, auth, groupId) => {
  const denied = denyBakers(auth, groupId);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const parsed = deleteQuery.safeParse({ name: params.get('name'), kind: params.get('kind') });
  if (!parsed.success) return errorResponse(parsed.error.message);

  try {
    const removed = await deleteHomeMade(groupId, parsed.data.name, parsed.data.kind);
    if (!removed.ok) return errorResponse(removed.error, removed.status);
  } catch (e) {
    console.error('[home-made] delete failed', e);
    return errorResponse('Could not delete the home-made ingredient', 500);
  }
  return jsonResponse({ ok: true });
});
