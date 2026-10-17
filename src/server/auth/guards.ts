import { getDb } from "../db";
import { type Actor, AuthorizationError, resolveActor, type Role } from "./actor";
import { auth } from "./auth";

export { type Actor, AuthorizationError, resolveActor, type Role };

/**
 * Server-side role check for every server action and route handler. Throws
 * `AuthorizationError` (UNAUTHENTICATED / FORBIDDEN). Never rely on the proxy alone.
 */
export async function requireRole(...roles: Role[]): Promise<Actor> {
  const session = await auth();
  return resolveActor(session?.user, roles, getDb());
}

/** Maps an AuthorizationError to an HTTP status for route handlers. */
export function authErrorStatus(error: unknown): 401 | 403 | null {
  return error instanceof AuthorizationError
    ? error.code === "UNAUTHENTICATED"
      ? 401
      : 403
    : null;
}
