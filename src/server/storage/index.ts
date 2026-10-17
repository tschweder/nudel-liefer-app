import { FakeStorage } from "./fake";
import { readS3Config, S3Storage } from "./s3";
import type { Storage } from "./types";

export { FakeStorage } from "./fake";
export { readS3Config, S3Storage } from "./s3";
export * from "./types";

let instance: Storage | undefined;

/**
 * Storage selected from the environment. Without S3_* variables a Fake is used (with a warning)
 * so dev and tests run; in production a missing configuration is an error because uploads
 * would silently be lost.
 */
export function getStorage(env: Record<string, string | undefined> = process.env): Storage {
  if (instance) return instance;
  const config = readS3Config(env);
  if (config) {
    instance = new S3Storage(config);
  } else if (env.NODE_ENV === "production") {
    throw new Error(
      "Object storage is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)",
    );
  } else {
    console.warn(
      "[storage] S3_* not configured - using the in-memory FakeStorage (uploads are not persisted)",
    );
    instance = new FakeStorage();
  }
  return instance;
}

/** Test helper. */
export function setStorageForTests(storage: Storage | undefined) {
  instance = storage;
}
