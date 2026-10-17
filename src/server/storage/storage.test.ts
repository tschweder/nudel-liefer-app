// @vitest-environment node
import { DeleteObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { FakeStorage } from "./fake";
import { getStorage, setStorageForTests } from "./index";
import { readS3Config, S3Storage } from "./s3";

const config = {
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  bucket: "nudel-photos",
  accessKeyId: "minio",
  secretAccessKey: "minio-secret",
};

describe("readS3Config", () => {
  it("returns null unless bucket and credentials are set", () => {
    expect(readS3Config({})).toBeNull();
    expect(readS3Config({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k" })).toBeNull();
  });
  it("maps the variables and defaults the region to auto", () => {
    expect(
      readS3Config({
        S3_BUCKET: "b",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
        S3_ENDPOINT: "",
      }),
    ).toEqual({
      endpoint: undefined,
      region: "auto",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
  });
});

describe("S3Storage (offline presigning, mocked client for delete)", () => {
  const storage = new S3Storage(config);

  it("presigns a PUT URL that signs content type and length", async () => {
    const target = await storage.createUploadUrl({
      key: "customers/a.jpg",
      contentType: "image/jpeg",
      contentLength: 123_456,
      expiresInSeconds: 300,
    });
    const url = new URL(target.url);
    expect(url.origin + url.pathname).toBe("http://localhost:9000/nudel-photos/customers/a.jpg");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("minio/");
    const signed = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signed.split(";")).toEqual(
      expect.arrayContaining(["content-length", "content-type", "host"]),
    );
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(target.method).toBe("PUT");
    expect(target.headers).toEqual({ "Content-Type": "image/jpeg" });
  });

  it("changes the signature when type or size change", async () => {
    const sig = async (contentType: string, contentLength: number) =>
      new URL(
        (await storage.createUploadUrl({ key: "k.jpg", contentType, contentLength })).url,
      ).searchParams.get("X-Amz-Signature");
    expect(await sig("image/jpeg", 10)).not.toBe(await sig("image/png", 10));
    expect(await sig("image/jpeg", 10)).not.toBe(await sig("image/jpeg", 11));
  });

  it("presigns GET URLs valid for 1 hour by default", async () => {
    const url = new URL(await storage.getReadUrl("customers/a.jpg"));
    expect(url.pathname).toBe("/nudel-photos/customers/a.jpg");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    const short = new URL(await storage.getReadUrl("customers/a.jpg", { expiresInSeconds: 60 }));
    expect(short.searchParams.get("X-Amz-Expires")).toBe("60");
  });

  it("sends a DeleteObject command for the key", async () => {
    const send = vi.fn().mockResolvedValue({});
    const mocked = new S3Storage(config, { send } as unknown as S3Client);
    await mocked.delete("customers/a.jpg");
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: "nudel-photos", Key: "customers/a.jpg" });
  });
});

describe("FakeStorage", () => {
  it("stores, signs and deletes in memory", async () => {
    const fake = new FakeStorage();
    const target = await fake.createUploadUrl({
      key: "a.jpg",
      contentType: "image/jpeg",
      contentLength: 3,
    });
    expect(target.url).toBe("fake://upload/a.jpg");
    fake.put("a.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    expect(fake.has("a.jpg")).toBe(true);
    expect(await fake.getReadUrl("a.jpg")).toContain("fake://read/a.jpg");
    await fake.delete("a.jpg");
    await fake.delete("a.jpg");
    expect(fake.has("a.jpg")).toBe(false);
  });
});

describe("getStorage", () => {
  it("uses the Fake with a warning when unconfigured, and fails in production", () => {
    setStorageForTests(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getStorage({})).toBeInstanceOf(FakeStorage);
    expect(warn).toHaveBeenCalledOnce();
    setStorageForTests(undefined);
    expect(() => getStorage({ NODE_ENV: "production" })).toThrow(/not configured/);
    setStorageForTests(undefined);
    expect(
      getStorage({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" }),
    ).toBeInstanceOf(S3Storage);
    setStorageForTests(undefined);
    warn.mockRestore();
  });
});

describe("S3Storage.checkReachable", () => {
  it("lists at most one key and resolves when the bucket answers", async () => {
    const send = vi.fn().mockResolvedValue({});
    await expect(
      new S3Storage(config, { send } as unknown as S3Client).checkReachable(),
    ).resolves.toBeUndefined();
    const command = send.mock.calls[0][0] as ListObjectsV2Command;
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input).toEqual({ Bucket: "nudel-photos", MaxKeys: 1 });
  });

  it("rejects on a missing bucket, bad credentials and network errors", async () => {
    for (const message of ["NoSuchBucket", "AccessDenied", "ECONNREFUSED"]) {
      const send = vi.fn().mockRejectedValue(new Error(message));
      await expect(
        new S3Storage(config, { send } as unknown as S3Client).checkReachable(),
      ).rejects.toThrow(message);
    }
  });
});
