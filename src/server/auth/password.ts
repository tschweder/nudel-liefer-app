import bcrypt from "bcryptjs";

const COST = 12;

/** Hashes a password or driver PIN (bcrypt; see decision log NUD-004). */
export function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, COST);
}

export function verifySecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

/** Valid bcrypt hash used to keep timing equal when the user does not exist. */
export const DUMMY_HASH = bcrypt.hashSync("dummy-secret-for-timing", COST);
