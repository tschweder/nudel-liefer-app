import { getDb } from "../db";
import { type Actor, authErrorStatus, AuthorizationError, resolveActor, type Role } from "./actor";
import { auth } from "./auth";

export { type Actor, authErrorStatus, AuthorizationError, resolveActor, type Role };

/**
 * Server-side role check for every server action and route handler. Throws
 * `AuthorizationError` (UNAUTHENTICATED / FORBIDDEN). Never rely on the proxy alone.
 */
export async function requireRole(...roles: Role[]): Promise<Actor> {
  const session = await auth();
  return resolveActor(session?.user, roles, getDb());
}
