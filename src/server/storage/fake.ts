import { READ_URL_TTL_SECONDS, type Storage, UPLOAD_URL_TTL_SECONDS } from "./types";

type StoredObject = { body: Uint8Array; contentType: string; modifiedAt: Date };

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

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { bytes: object.body.byteLength, contentType: object.contentType } : null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(prefix: string, options?: { limit?: number; continuationToken?: string }) {
    const limit = Math.min(options?.limit ?? 1000, 1000);
    const keys = [...this.objects.keys()]
      .filter(
        (key) =>
          key.startsWith(prefix) &&
          (!options?.continuationToken || key > options.continuationToken),
      )
      .sort();
    const page = keys.slice(0, limit);
    return {
      objects: page.map((key) => {
        const object = this.objects.get(key)!;
        return { key, bytes: object.body.byteLength, lastModified: object.modifiedAt };
      }),
      nextToken: keys.length > limit ? page[page.length - 1] : undefined,
    };
  }

  async checkReachable() {}

  /** Test helper: simulates the client's PUT to the presigned URL. */
  put(key: string, body: Uint8Array, contentType: string, modifiedAt: Date = new Date()) {
    this.objects.set(key, { body, contentType, modifiedAt });
  }

  has(key: string) {
    return this.objects.has(key);
  }
}
