import { withBasePath } from "./base-path";
import {
  computeTargetSize,
  isAllowedImageType,
  isUsableUploadUrl,
  JPEG_QUALITY,
  MAX_LONG_EDGE,
  MAX_UPLOAD_BYTES,
  type UploadGrant,
  type UploadPurpose,
} from "./uploads";

export type UploadErrorCode =
  | "NOT_AN_IMAGE"
  | "HEIC_UNSUPPORTED"
  | "DECODE_FAILED"
  | "TOO_LARGE"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "REQUEST_FAILED"
  | "UPLOAD_FAILED"
  | "ABORTED";

export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "UploadError";
  }
}

export type UploadedImage = { storageKey: string; width: number; height: number; bytes: number };

export type UploadImageOptions = {
  purpose: UploadPurpose;
  /** Called with 0..1 while the (already resized) image is sent. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

const HEIC_PATTERN = /\.(heic|heif)$/i;

export function isHeic(file: { type: string; name?: string }): boolean {
  return /^image\/hei[cf]/i.test(file.type) || HEIC_PATTERN.test(file.name ?? "");
}

/** Decides which error a failed decode is: HEIC is a known limitation outside Safari. */
export function classifyDecodeFailure(file: { type: string; name?: string }): UploadError {
  return isHeic(file) ? new UploadError("HEIC_UNSUPPORTED") : new UploadError("DECODE_FAILED");
}

/**
 * Decodes the image (honouring EXIF orientation), scales it so the longest edge is at most
 * `MAX_LONG_EDGE` and re-encodes it as JPEG (quality 0.8). Re-encoding also drops EXIF/GPS data.
 * HEIC is decoded only where the browser can do it (Safari); elsewhere a clear error is thrown.
 */
export async function resizeImage(
  file: File | Blob,
  maxEdge: number = MAX_LONG_EDGE,
): Promise<{ blob: Blob; width: number; height: number }> {
  const named = { type: file.type, name: (file as File).name };
  if (!file.type.startsWith("image/") && !isHeic(named)) throw new UploadError("NOT_AN_IMAGE");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw classifyDecodeFailure(named);
  }
  try {
    const { width, height } = computeTargetSize(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UploadError("DECODE_FAILED");
    // JPEG has no alpha: paint white under transparent PNG/WebP areas.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new UploadError("DECODE_FAILED");
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

export async function requestUploadGrant(
  purpose: UploadPurpose,
  blob: Blob,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadGrant> {
  let response: Response;
  try {
    response = await fetchImpl(withBasePath("/api/uploads"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, contentType: blob.type, size: blob.size }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new UploadError("ABORTED");
    throw new UploadError("REQUEST_FAILED", String(error));
  }
  if (response.status === 401) throw new UploadError("UNAUTHENTICATED");
  if (response.status === 403) throw new UploadError("FORBIDDEN");
  if (response.status === 413) throw new UploadError("TOO_LARGE");
  if (!response.ok) throw new UploadError("REQUEST_FAILED", `HTTP ${response.status}`);
  const grant = (await response.json()) as UploadGrant;
  // Defence in depth (NUD-122): a URL the browser cannot PUT to must never look like a success.
  if (!isUsableUploadUrl(grant.uploadUrl)) {
    throw new UploadError("UPLOAD_FAILED", "storage is not configured");
  }
  return grant;
}

/** PUTs the blob to the presigned URL with progress reporting (XHR, since fetch has none). */
export function putWithProgress(
  grant: Pick<UploadGrant, "uploadUrl" | "method" | "headers">,
  blob: Blob,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  createXhr: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = createXhr();
    const onAbort = () => xhr.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => options.signal?.removeEventListener("abort", onAbort);
    xhr.open(grant.method, grant.uploadUrl);
    for (const [name, value] of Object.entries(grant.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve();
      } else {
        reject(new UploadError("UPLOAD_FAILED", `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      done();
      reject(new UploadError("UPLOAD_FAILED"));
    };
    xhr.onabort = () => {
      done();
      reject(new UploadError("ABORTED"));
    };
    if (options.signal?.aborted) return xhr.abort();
    xhr.send(blob);
  });
}

/**
 * Client entry point: resize -> ask the server for a presigned URL -> upload with progress.
 * Resolves with the storage key to persist (e.g. in `Photo.storageKey`).
 */
export async function uploadImage(
  file: File | Blob,
  options: UploadImageOptions,
): Promise<UploadedImage> {
  const { blob, width, height } = await resizeImage(file);
  if (blob.size > MAX_UPLOAD_BYTES || !isAllowedImageType(blob.type)) {
    throw new UploadError("TOO_LARGE");
  }
  const grant = await requestUploadGrant(options.purpose, blob, options.signal);
  await putWithProgress(grant, blob, options);
  return { storageKey: grant.storageKey, width, height, bytes: blob.size };
}
