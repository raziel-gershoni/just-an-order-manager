import { authenticateRequest, type AuthContext } from './telegram-auth';

export function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * For a route under /api/groups/:id/<thing> wrapped in withGroup: refuses a path
 * id other than the X-Group-Id group, and anyone but an owner or a manager.
 * Null when the request may go on.
 */
export function refuseUnlessManager(request: Request, auth: AuthContext, groupId: number): Response | null {
  const pathId = Number(new URL(request.url).pathname.split('/').at(-2));
  if (pathId !== groupId) return errorResponse('Group mismatch', 400);
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager') return errorResponse('Forbidden', 403);
  return null;
}

type AuthenticatedHandler = (
  request: Request,
  auth: AuthContext
) => Promise<Response>;

type GroupHandler = (
  request: Request,
  auth: AuthContext,
  groupId: number
) => Promise<Response>;

export function withAuth(handler: AuthenticatedHandler) {
  return async (request: Request) => {
    try {
      const auth = await authenticateRequest(request);
      return handler(request, auth);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[auth]', message);
      return errorResponse(`Unauthorized: ${message}`, 401);
    }
  };
}

export function withGroup(handler: GroupHandler) {
  return withAuth(async (request, auth) => {
    const groupId = Number(
      request.headers.get('x-group-id') ||
        new URL(request.url).searchParams.get('groupId')
    );

    if (!groupId || isNaN(groupId)) {
      return errorResponse('Missing group ID', 400);
    }

    const membership = auth.memberships.find((m) => m.groupId === groupId);
    if (!membership) {
      return errorResponse('Not a member of this group', 403);
    }

    return handler(request, auth, groupId);
  });
}
