import { auth } from "./auth/auth";

/** Current user id from the Auth.js session, or null when nobody is logged in. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id || null;
}
