import { READ_URL_TTL_SECONDS, type Storage, UPLOAD_URL_TTL_SECONDS } from "./types";

type StoredObject = { body: Uint8Array; contentType: string };

/** In-memory storage for tests and for local runs without S3 configuration. */
export class FakeStorage implements Storage {
  readonly objects = new Map<string, StoredObject>();

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }) {
    const ttl = input.expiresInSeconds ?? UPLOAD_URL_TTL_SECONDS;
    return {
      url: `fake://upload/${input.key}`,
      method: "PUT" as const,
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  async getReadUrl(key: string, options?: { expiresInSeconds?: number }) {
    const ttl = options?.expiresInSeconds ?? READ_URL_TTL_SECONDS;
    return `fake://read/${key}?expires=${ttl}`;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  /** Test helper: simulates the client's PUT to the presigned URL. */
  put(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body, contentType });
  }

  has(key: string) {
    return this.objects.has(key);
  }
}
