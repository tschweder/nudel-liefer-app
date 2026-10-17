import type { PrismaClient } from "@/generated/prisma/client";
import { dbLocaleToTag } from "@/lib/localized-text";

export type Role = "ADMIN" | "DRIVER";

export class AuthorizationError extends Error {
  constructor(
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthorizationError";
  }
}

export type Actor = { id: string; role: Role; locale: string; name: string };

/**
 * Resolves the actor from the session claims against the database: the user must still exist and
 * be active, and the DB role (not the token's) must be one of `roles`.
 */
export async function resolveActor(
  claims: { id?: string | null } | null | undefined,
  roles: Role[],
  db: Pick<PrismaClient, "user">,
): Promise<Actor> {
  if (!claims?.id) throw new AuthorizationError("UNAUTHENTICATED");
  const user = await db.user.findUnique({ where: { id: claims.id } });
  if (!user || !user.active) throw new AuthorizationError("UNAUTHENTICATED");
  if (!roles.includes(user.role)) throw new AuthorizationError("FORBIDDEN");
  return {
    id: user.id,
    role: user.role,
    locale: dbLocaleToTag(user.locale),
    name: user.displayName,
  };
}

/** Maps an AuthorizationError to an HTTP status for route handlers. */
export function authErrorStatus(error: unknown): 401 | 403 | null {
  return error instanceof AuthorizationError
    ? error.code === "UNAUTHENTICATED"
      ? 401
      : 403
    : null;
}
