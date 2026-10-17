import { z } from "zod";

/** Content types the upload API accepts (the client re-encodes to JPEG, see `uploadImage`). */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Hard server-side limit for one uploaded object (after client-side resizing). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Longest edge of the stored image in pixels. */
export const MAX_LONG_EDGE = 1600;
export const JPEG_QUALITY = 0.8;

/** What an upload is for. The server derives the key prefix and the allowed roles from it. */
export const UPLOAD_PURPOSES = ["customer-photo", "screenshot"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const uploadRequestSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.string(),
  size: z.number().int().positive(),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export type UploadGrant = {
  storageKey: string;
  uploadUrl: string;
  method: "PUT";
  /** Headers the client must send unchanged with the PUT. */
  headers: Record<string, string>;
  expiresAt: string;
};

export function isAllowedImageType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

export function extensionFor(type: AllowedImageType): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" }[
    type
  ];
}

/** Scales (width, height) down so the longest edge is at most `maxEdge`; never upscales. */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge: number = MAX_LONG_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
