import { randomUUID } from "node:crypto";

import {
  extensionFor,
  isAllowedImageType,
  MAX_UPLOAD_BYTES,
  type UploadGrant,
  type UploadPurpose,
  uploadRequestSchema,
} from "@/lib/uploads";

import { type Actor, authErrorStatus, type Role } from "./auth/actor";
import { rejectCrossOrigin } from "./csrf";
import { readTextLimited } from "./http-body";
import type { Storage } from "./storage/types";

/** Who may upload what. Drivers photograph shops/parking (NUD-083); screenshots are office-only. */
export const PURPOSE_ROLES: Record<UploadPurpose, Role[]> = {
  "customer-photo": ["ADMIN", "DRIVER"],
  screenshot: ["ADMIN"],
};

const KEY_PREFIX: Record<UploadPurpose, string> = {
  "customer-photo": "customers",
  screenshot: "screenshots",
};

export type UploadDeps = {
  requireRole: (...roles: Role[]) => Promise<Actor>;
  storage: () => Storage;
};

/** The request names a purpose, a type and a size: a few dozen bytes. */
const UPLOAD_REQUEST_MAX_BODY_BYTES = 2 * 1024;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * `POST /api/uploads`: validates the caller and the declared file, then returns a presigned PUT
 * URL. The storage key is always chosen by the server.
 */
export async function handleCreateUpload(request: Request, deps: UploadDeps): Promise<Response> {
  // Authenticate first (any of the roles), so anonymous callers learn nothing about validation.
  let actor: Actor;
  try {
    actor = await deps.requireRole("ADMIN", "DRIVER");
  } catch (error) {
    const status = authErrorStatus(error);
    if (status) return json({ error: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" }, status);
    throw error;
  }

  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const body = await readTextLimited(request, UPLOAD_REQUEST_MAX_BODY_BYTES);
  if (body === null) return json({ error: "TOO_LARGE_REQUEST" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }
  const parsed = uploadRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "INVALID_REQUEST" }, 400);
  const { purpose, contentType, size } = parsed.data;

  if (!PURPOSE_ROLES[purpose].includes(actor.role)) return json({ error: "FORBIDDEN" }, 403);
  if (!isAllowedImageType(contentType)) return json({ error: "UNSUPPORTED_CONTENT_TYPE" }, 400);
  if (size > MAX_UPLOAD_BYTES) return json({ error: "TOO_LARGE", maxBytes: MAX_UPLOAD_BYTES }, 413);

  const storageKey = `${KEY_PREFIX[purpose]}/${randomUUID()}.${extensionFor(contentType)}`;
  const target = await deps.storage().createUploadUrl({
    key: storageKey,
    contentType,
    contentLength: size,
  });
  const grant: UploadGrant = {
    storageKey,
    uploadUrl: target.url,
    method: target.method,
    headers: target.headers,
    expiresAt: target.expiresAt.toISOString(),
  };
  return json(grant, 200);
}
