export type UploadTarget = {
  url: string;
  method: "PUT";
  /** Headers the client must send with the PUT (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
};

/** One stored object as the bucket listing reports it. */
export type StoredObjectInfo = { key: string; bytes: number; lastModified: Date };

/** Private object storage. Implementations: S3-compatible (MinIO, R2) and an in-memory Fake. */
export interface Storage {
  /** Presigned PUT URL for exactly one object of the given type and size. */
  createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }): Promise<UploadTarget>;
  /** Short-lived signed GET URL (default 1 h). The bucket itself stays private. */
  getReadUrl(key: string, options?: { expiresInSeconds?: number }): Promise<string>;
  /** Size and type of a stored object, or `null` when the key does not exist. */
  head(key: string): Promise<{ bytes: number; contentType: string | null } | null>;
  /** Deletes an object; deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /**
   * Objects below a key prefix, in key order, `limit` (default and maximum 1000) per page; pass the
   * returned `nextToken` to continue. Used by the orphan cleanup (NUD-094); never changes anything.
   */
  list(
    prefix: string,
    options?: { limit?: number; continuationToken?: string },
  ): Promise<{ objects: StoredObjectInfo[]; nextToken?: string }>;
  /**
   * Resolves when the storage backend is reachable and the credentials are accepted.
   * Rejects otherwise. Used by `GET /api/health`; must not create or change anything.
   */
  checkReachable(): Promise<void>;
}

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const READ_URL_TTL_SECONDS = 60 * 60;
