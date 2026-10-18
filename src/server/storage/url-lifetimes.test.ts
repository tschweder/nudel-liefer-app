// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DRIVER_PHOTO_URL_TTL_SECONDS } from "../driver-tour-payload";
import { readS3Config, S3Storage } from "./s3";
import { READ_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from "./types";

// NUD-093 review of signed URL lifetimes. Changing one of these numbers is a security decision:
// update docs/deploy.md ("Signed URL lifetimes") together with this test.
describe("signed URL lifetimes", () => {
  it("pins the three lifetimes", () => {
    expect(UPLOAD_URL_TTL_SECONDS).toBe(5 * 60); // presigned PUT
    expect(READ_URL_TTL_SECONDS).toBe(60 * 60); // admin pages, driver stop detail
    expect(DRIVER_PHOTO_URL_TTL_SECONDS).toBe(12 * 60 * 60); // offline tour copy: one working day
  });

  it("the S3 implementation signs exactly those lifetimes by default", async () => {
    const config = readS3Config({
      S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      S3_REGION: "auto",
      S3_BUCKET: "photos",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    });
    const storage = new S3Storage(config!);
    const expires = (url: string) => new URL(url).searchParams.get("X-Amz-Expires");
    expect(expires(await storage.getReadUrl("customers/a.jpg"))).toBe("3600");
    expect(
      expires(
        await storage.getReadUrl("customers/a.jpg", {
          expiresInSeconds: DRIVER_PHOTO_URL_TTL_SECONDS,
        }),
      ),
    ).toBe("43200");
    const upload = await storage.createUploadUrl({
      key: "customers/a.jpg",
      contentType: "image/jpeg",
      contentLength: 10,
    });
    expect(expires(upload.url)).toBe("300");
  });
});
