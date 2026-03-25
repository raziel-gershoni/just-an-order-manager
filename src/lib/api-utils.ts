import { authenticateRequest, type AuthContext } from './telegram-auth';

export function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
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
    } catch {
      return errorResponse('Unauthorized', 401);
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
