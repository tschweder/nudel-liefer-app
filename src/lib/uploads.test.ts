import { describe, expect, it } from "vitest";

import { classifyDecodeFailure, isHeic, putWithProgress, UploadError } from "./upload-image";
import { computeTargetSize, extensionFor, isAllowedImageType } from "./uploads";
import { clampScale, zoomAt } from "./zoom";

describe("computeTargetSize", () => {
  it("scales a 6000x4000 photo to 1600x1067", () => {
    expect(computeTargetSize(6000, 4000)).toEqual({ width: 1600, height: 1067 });
  });
  it("handles portrait and never upscales", () => {
    expect(computeTargetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(computeTargetSize(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it("never produces a zero edge", () => {
    expect(computeTargetSize(100000, 10)).toEqual({ width: 1600, height: 1 });
  });
});

describe("content types", () => {
  it("allows exactly jpeg, png, webp, heic", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic"]) {
      expect(isAllowedImageType(t)).toBe(true);
    }
    for (const t of ["image/gif", "image/svg+xml", "application/pdf", ""]) {
      expect(isAllowedImageType(t)).toBe(false);
    }
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("HEIC handling", () => {
  it("detects HEIC by type or extension (browsers often send an empty type)", () => {
    expect(isHeic({ type: "image/heic" })).toBe(true);
    expect(isHeic({ type: "", name: "IMG_0001.HEIC" })).toBe(true);
    expect(isHeic({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
  });
  it("turns an undecodable HEIC into a dedicated error", () => {
    expect(classifyDecodeFailure({ type: "image/heic" }).code).toBe("HEIC_UNSUPPORTED");
    expect(classifyDecodeFailure({ type: "image/png" }).code).toBe("DECODE_FAILED");
  });
});

class FakeXhr {
  status = 200;
  headers: Record<string, string> = {};
  upload: {
    onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  opened?: [string, string];
  sent?: Blob;
  open(method: string, url: string) {
    this.opened = [method, url];
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: Blob) {
    this.sent = body;
  }
  abort() {
    this.onabort?.();
  }
}

describe("putWithProgress", () => {
  const grant = {
    uploadUrl: "http://s3/x",
    method: "PUT" as const,
    headers: { "Content-Type": "image/jpeg" },
  };

  it("sends the headers, reports progress and resolves on 2xx", async () => {
    const xhr = new FakeXhr();
    const seen: number[] = [];
    const blob = new Blob(["abc"], { type: "image/jpeg" });
    const p = putWithProgress(grant, blob, { onProgress: (f) => seen.push(f) }, () => xhr as never);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.onload?.();
    await p;
    expect(xhr.opened).toEqual(["PUT", "http://s3/x"]);
    expect(xhr.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(xhr.sent).toBe(blob);
    expect(seen).toEqual([0.25, 1]);
  });

  it("rejects non-2xx, network errors and aborts with typed errors", async () => {
    const bad = new FakeXhr();
    bad.status = 403;
    const p1 = putWithProgress(grant, new Blob(["a"]), {}, () => bad as never);
    bad.onload?.();
    await expect(p1).rejects.toMatchObject({ code: "UPLOAD_FAILED" });

    const net = new FakeXhr();
    const p2 = putWithProgress(grant, new Blob(["a"]), {}, () => net as never);
    net.onerror?.();
    await expect(p2).rejects.toBeInstanceOf(UploadError);

    const ctrl = new AbortController();
    const ab = new FakeXhr();
    const p3 = putWithProgress(grant, new Blob(["a"]), { signal: ctrl.signal }, () => ab as never);
    ctrl.abort();
    await expect(p3).rejects.toMatchObject({ code: "ABORTED" });
  });
});

describe("zoom maths", () => {
  it("clamps the scale and returns to identity at 1", () => {
    expect(clampScale(20)).toBe(8);
    expect(clampScale(0.2)).toBe(1);
    expect(zoomAt({ scale: 2, x: 5, y: 5 }, 0.1, { x: 0, y: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it("keeps the focus point fixed", () => {
    const v = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
    expect(v).toEqual({ scale: 2, x: -100, y: -50 });
    // a point at focus maps to the same screen position: focus = x + scale * p  with p = focus (scale 1)
    expect(v.x + v.scale * 100).toBe(100);
  });
});
