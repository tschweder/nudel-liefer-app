import { FakeStorage } from "./fake";
import { readS3Config, S3Storage } from "./s3";
import type { Storage } from "./types";

export { FakeStorage } from "./fake";
export { readS3Config, S3Storage } from "./s3";
export * from "./types";

let s3Instance: Storage | undefined;
let fakeInstance: Storage | undefined;

/**
 * Storage selected from the environment. Without S3_* variables a Fake is used (with a warning)
 * so dev and tests run; in production a missing configuration is an error because uploads
 * would silently be lost.
 *
 * The configuration is re-read on every call: a process that once ran without S3_* must not stay
 * pinned to the in-memory Fake for its whole lifetime (NUD-122 - an unresolved environment made
 * every photo upload die as `object_missing` while the UI still looked alive). The real client is
 * still cached, and a Fake that cannot store anything is never handed out as a working upload
 * target (`POST /api/uploads` refuses a non-HTTP URL).
 */
export function getStorage(env: Record<string, string | undefined> = process.env): Storage {
  const config = readS3Config(env);
  if (config) {
    s3Instance ??= new S3Storage(config);
    return s3Instance;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Object storage is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)",
    );
  }
  if (!fakeInstance) {
    console.warn(
      "[storage] S3_* not configured - using the in-memory FakeStorage (uploads are not persisted)",
    );
    fakeInstance = new FakeStorage();
  }
  return fakeInstance;
}

/** Test helper. */
export function setStorageForTests(storage: Storage | undefined) {
  s3Instance = storage;
  fakeInstance = storage;
}
