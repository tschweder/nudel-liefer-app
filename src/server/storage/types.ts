export type UploadTarget = {
  url: string;
  method: "PUT";
  /** Headers the client must send with the PUT (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
};

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
  /** Deletes an object; deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const READ_URL_TTL_SECONDS = 60 * 60;
