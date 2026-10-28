import type { Storage } from "./types";

/**
 * Writes one object through the presigned URL the `Storage` interface hands out. The interface
 * deliberately has no `put`, so that the server never holds a bucket credential that can write
 * anywhere: it signs a URL for exactly one key and one size, and the bytes go straight to the
 * bucket with a plain PUT.
 *
 * A `fake://` URL (the in-memory `FakeStorage`, i.e. no S3_* configured) is refused loudly instead
 * of silently pretending the photo was stored — a script that "succeeds" while nothing is persisted
 * is worse than one that fails.
 */
export type UploadObject = (
  storage: Pick<Storage, "createUploadUrl">,
  key: string,
  body: Buffer,
  contentType: string,
) => Promise<void>;

export const uploadWithPresignedUrl: UploadObject = async (storage, key, body, contentType) => {
  const target = await storage.createUploadUrl({ key, contentType, contentLength: body.length });
  const protocol = new URL(target.url).protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(
      `Refusing to upload ${key} to a non-HTTP storage URL (${protocol}//). ` +
        "Object storage is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).",
    );
  }
  const response = await fetch(target.url, {
    method: target.method,
    headers: target.headers,
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    throw new Error(`Uploading ${key} failed: HTTP ${response.status} ${await response.text()}`);
  }
};
