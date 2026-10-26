import { afterEach, describe, expect, it, vi } from "vitest";

// The module under test is the one the office and the driver client use; it had no test of its own
// (NUD-122): `uploads.test.ts` covers the pure helpers and `putWithProgress`, but decoding, the
// grant and the end-to-end flow were only exercised through mocks in component tests.
import {
  requestUploadGrant,
  resizeImage,
  type UploadedImage,
  UploadError,
  uploadImage,
} from "./upload-image";
import { JPEG_QUALITY, type UploadGrant } from "./uploads";

const grant: UploadGrant = {
  storageKey: "customers/6f1e6a2c-0000-4000-8000-000000000000.jpg",
  uploadUrl:
    "https://s3.test/nudel-photos/customers/6f1e6a2c-0000-4000-8000-000000000000.jpg?sig=x",
  method: "PUT",
  headers: { "Content-Type": "image/jpeg" },
  expiresAt: "2099-07-02T08:05:00.000Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** jsdom has neither a real decoder nor a canvas backend: stub both, and count the calls. */
function stubCanvas(options: { context?: boolean; blob?: boolean } = {}) {
  const close = vi.fn();
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4000, height: 3000, close })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    options.context === false
      ? null
      : ({ fillStyle: "", imageSmoothingQuality: "", fillRect, drawImage } as never),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(options.blob === false ? null : new Blob(["jpeg-bytes"], { type: "image/jpeg" }));
  });
  return { close, drawImage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resizeImage", () => {
  it("decodes, scales to the long edge and re-encodes as JPEG", async () => {
    const { close, drawImage } = stubCanvas();
    const result = await resizeImage(new Blob(["x"], { type: "image/png" }));

    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);
    expect(result.blob.type).toBe("image/jpeg");
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(close).toHaveBeenCalledOnce();
    expect(JPEG_QUALITY).toBe(0.8);
  });

  it("refuses a file that is not an image at all", async () => {
    stubCanvas();
    await expect(
      resizeImage(new Blob(["%PDF"], { type: "application/pdf" })),
    ).rejects.toMatchObject({ code: "NOT_AN_IMAGE" });
  });

  it("names HEIC as a limitation instead of a generic decode failure", async () => {
    stubCanvas();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("no decoder");
      }),
    );
    await expect(resizeImage(new Blob(["heic"], { type: "image/heic" }))).rejects.toMatchObject({
      code: "HEIC_UNSUPPORTED",
    });
    await expect(resizeImage(new Blob(["png"], { type: "image/png" }))).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });
  });

  it("reports a missing 2D context and an empty encode", async () => {
    stubCanvas({ context: false });
    await expect(resizeImage(new Blob(["x"], { type: "image/png" }))).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });

    stubCanvas({ blob: false });
    await expect(resizeImage(new Blob(["x"], { type: "image/png" }))).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });
  });
});

describe("requestUploadGrant", () => {
  const blob = new Blob(["jpeg"], { type: "image/jpeg" });
  const fetchWith = (response: Response) => vi.fn(async () => response) as unknown as typeof fetch;

  it("returns the grant the server issued", async () => {
    const result = await requestUploadGrant(
      "customer-photo",
      blob,
      undefined,
      fetchWith(json(grant)),
    );
    expect(result).toMatchObject({ storageKey: grant.storageKey, uploadUrl: grant.uploadUrl });
  });

  it("maps the documented statuses to typed errors", async () => {
    const cases: Array<[number, string]> = [
      [401, "UNAUTHENTICATED"],
      [403, "FORBIDDEN"],
      [413, "TOO_LARGE"],
      [500, "REQUEST_FAILED"],
      [503, "REQUEST_FAILED"],
    ];
    for (const [status, code] of cases) {
      const fetchImpl = fetchWith(json({ error: "x" }, status));
      await expect(
        requestUploadGrant("customer-photo", blob, undefined, fetchImpl),
        String(status),
      ).rejects.toMatchObject({ code });
    }
  });

  it("reports a dead network and an abort", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(
      requestUploadGrant("customer-photo", blob, undefined, failing),
    ).rejects.toMatchObject({ code: "REQUEST_FAILED" });

    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn(async () => {
      throw new TypeError("aborted");
    }) as unknown as typeof fetch;
    await expect(
      requestUploadGrant("customer-photo", blob, controller.signal, aborted),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("refuses a grant no browser could PUT to (unconfigured storage, NUD-122)", async () => {
    const fake = { ...grant, uploadUrl: "fake://upload/customers/key-1.jpg" };
    await expect(
      requestUploadGrant("customer-photo", blob, undefined, fetchWith(json(fake))),
    ).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
  });
});

class FakeXhr {
  status = 200;
  headers: Record<string, string> = {};
  upload: {
    onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  opened?: [string, string];
  sent?: Blob;
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  open(method: string, url: string) {
    this.opened = [method, url];
  }
  send(body: Blob) {
    this.sent = body;
    queueMicrotask(() => this.onload?.());
  }
  abort() {
    this.onabort?.();
  }
}

describe("uploadImage", () => {
  it("resizes, asks for a grant, PUTs the blob and returns the storage key", async () => {
    stubCanvas();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(grant)),
    );
    const xhrs: FakeXhr[] = [];
    vi.stubGlobal(
      "XMLHttpRequest",
      class extends FakeXhr {
        constructor() {
          super();
          xhrs.push(this);
        }
      },
    );

    const result: UploadedImage = await uploadImage(new Blob(["photo"], { type: "image/png" }), {
      purpose: "customer-photo",
    });

    expect(result.storageKey).toBe(grant.storageKey);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);
    expect(result.bytes).toBeGreaterThan(0);
    expect(xhrs[0].opened).toEqual(["PUT", grant.uploadUrl]);
    expect(xhrs[0].headers).toEqual({ "Content-Type": "image/jpeg" });
  });

  it("never reports success when the PUT is rejected", async () => {
    stubCanvas();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(grant)),
    );
    vi.stubGlobal(
      "XMLHttpRequest",
      class extends FakeXhr {
        constructor() {
          super();
          this.status = 403;
          this.onload = () => undefined;
        }
        override send(body: Blob) {
          this.sent = body;
          queueMicrotask(() => this.onload?.());
        }
      },
    );

    await expect(
      uploadImage(new Blob(["photo"], { type: "image/png" }), { purpose: "customer-photo" }),
    ).rejects.toBeInstanceOf(UploadError);
  });
});
