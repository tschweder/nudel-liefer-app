"use client";

import {
  CameraIcon,
  CheckIcon,
  ImageOffIcon,
  Loader2Icon,
  RefreshCwIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ImagePreview } from "@/components/shared/image-preview";
import { Button } from "@/components/ui/button";
import type { DriverPhotoKind } from "@/domain/driver-photo";
import type { ShownPhoto } from "@/lib/offline/photo-outbox";
import { enqueuePhoto } from "@/lib/offline/photo-outbox-browser";
import { resizeImage, UploadError } from "@/lib/upload-image";

type Phase =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "preview"; blob: Blob; width: number; height: number; url: string }
  | { name: "saving" };

type Props = {
  kind: DriverPhotoKind;
  label: string;
  alt: string;
  photo: ShownPhoto | null;
  stopId: string;
  customerId: string;
  customerName: string;
};

/**
 * One photo slot of the stop screen (STORE or PARKING) with the camera built in (NUD-083).
 * - No photo: the placeholder itself offers "Take photo" (a file input with `capture="environment"`
 *   opens the phone camera directly).
 * - Photo present: "Replace photo" below it.
 * - After the shot: the resized picture is shown in the same 4:3 frame with "Use photo" /
 *   "Retake" / "Cancel". "Use photo" puts it in the on-device queue (works offline); the slot shows
 *   it at once, marked "waiting to be sent" until the server has taken it ("sent").
 */
export function DriverPhotoSlot({
  kind,
  label,
  alt,
  photo,
  stopId,
  customerId,
  customerName,
}: Props) {
  const t = useTranslations("driver.stop");
  const tErrors = useTranslations("common.upload.errors");
  const id = kind.toLowerCase();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const previewUrl = phase.name === "preview" ? phase.url : null;

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErrorCode(null);
    setPhase({ name: "preparing" });
    try {
      // Decode, scale to 1600 px, JPEG q 0.8, strip EXIF/GPS: same pipeline as the office upload.
      const { blob, width, height } = await resizeImage(file);
      setPhase({ name: "preview", blob, width, height, url: URL.createObjectURL(blob) });
    } catch (error) {
      setErrorCode(error instanceof UploadError ? error.code : "DECODE_FAILED");
      setPhase({ name: "idle" });
    }
  }

  async function confirm() {
    if (phase.name !== "preview") return;
    const { blob, width, height } = phase;
    setPhase({ name: "saving" });
    try {
      await enqueuePhoto({ stopId, customerId, customerName, kind, blob, width, height });
      setPhase({ name: "idle" });
    } catch {
      // No storage on the device (private mode, full): the photo could not be kept.
      setErrorCode("STORAGE_FAILED");
      setPhase({ name: "idle" });
    }
  }

  const take = () => input.current?.click();
  const busy = phase.name === "preparing" || phase.name === "saving";

  return (
    <section className="space-y-2" data-testid={`photo-${id}`}>
      <h2 className="text-lg font-semibold">{label}</h2>
      {/* Fixed 4:3 box: a missing, slow or broken photo never changes the layout. */}
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-muted"
        data-testid="photo-frame"
      >
        {phase.name === "preview" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob of the photo just taken
          <img
            src={phase.url}
            alt={alt}
            className="size-full object-contain"
            data-testid="photo-preview"
          />
        ) : busy ? (
          <div
            className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground"
            role="status"
            data-testid="photo-busy"
          >
            <Loader2Icon className="size-12 animate-spin" aria-hidden />
            <span className="text-base font-medium">{t("photoPreparing")}</span>
          </div>
        ) : photo ? (
          <>
            <ImagePreview
              src={photo.url}
              alt={alt}
              fit="contain"
              className="size-full rounded-none"
            />
            {photo.pending ? (
              <span
                role="status"
                data-testid="photo-pending"
                className="absolute start-2 top-2 flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-base font-bold text-amber-950"
              >
                <UploadCloudIcon className="size-5 shrink-0" aria-hidden />
                {t("photoPending")}
              </span>
            ) : photo.sent ? (
              <span
                role="status"
                data-testid="photo-sent"
                className="absolute start-2 top-2 flex items-center gap-1.5 rounded-full bg-green-700 px-3 py-1 text-base font-bold text-white"
              >
                <CheckIcon className="size-5 shrink-0" aria-hidden />
                {t("photoSent")}
              </span>
            ) : null}
          </>
        ) : (
          <div
            className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground"
            data-testid="photo-missing"
          >
            <ImageOffIcon className="size-12" aria-hidden />
            <span className="text-base font-medium">{t("noPhoto")}</span>
            <Button
              type="button"
              size="lg"
              className="min-h-14 text-lg"
              onClick={take}
              data-testid={`photo-take-${id}`}
            >
              <CameraIcon className="size-6" aria-hidden />
              {t("takePhoto")}
            </Button>
          </div>
        )}
      </div>

      {phase.name === "preview" ? (
        <div className="grid grid-cols-2 gap-3" data-testid="photo-confirm-bar">
          <Button
            type="button"
            size="lg"
            className="col-span-2 min-h-14 text-lg"
            onClick={() => void confirm()}
            data-testid="photo-confirm"
          >
            <CheckIcon className="size-6" aria-hidden />
            {t("usePhoto")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-14 text-lg"
            onClick={take}
            data-testid="photo-retake"
          >
            <RefreshCwIcon className="size-5" aria-hidden />
            {t("retakePhoto")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-14 text-lg"
            onClick={() => setPhase({ name: "idle" })}
            data-testid="photo-cancel"
          >
            <XIcon className="size-5" aria-hidden />
            {t("cancelPhoto")}
          </Button>
        </div>
      ) : photo && !busy ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="min-h-14 w-full text-lg"
          onClick={take}
          data-testid={`photo-replace-${id}`}
        >
          <CameraIcon className="size-6" aria-hidden />
          {t("replacePhoto")}
        </Button>
      ) : null}

      {errorCode ? (
        <p
          role="alert"
          className="text-base font-medium text-destructive"
          data-testid="photo-error"
        >
          {errorCode === "STORAGE_FAILED"
            ? t("photoNotSaved")
            : tErrors(errorCode as "DECODE_FAILED")}
        </p>
      ) : null}

      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label={t("takePhoto")}
        data-testid={`photo-input-${id}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void onFile(file);
        }}
      />
    </section>
  );
}
