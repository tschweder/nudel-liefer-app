"use client";

import { CheckCircle2Icon, ImageOffIcon, RefreshCwIcon, TruckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ImagePreview } from "@/components/shared/image-preview";
import { ImageUploader } from "@/components/shared/image-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PhotoKind } from "@/domain/photos";
import { useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import type { UploadedImage } from "@/lib/upload-image";
import { addCustomerPhotoAction } from "@/server/customer-actions";

export type PhotoSlotValue = {
  id: string;
  /** Signed read URL, generated on the server. */
  url: string;
  width: number;
  height: number;
  /** When this photo was added (ISO). */
  createdAt?: string;
  /** Display name of the driver who took it; `null` when the office uploaded it. */
  driverName?: string | null;
};

type Props = {
  customerId: string;
  customerName: string;
  photos: Record<PhotoKind, PhotoSlotValue | null>;
};

const SLOTS: PhotoKind[] = ["STORE", "PARKING"];

/** The two photo slots of a customer: upload, replace and fullscreen view (admin). */
export function CustomerPhotoSlots({ customerId, customerName, photos }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="photo-slots">
      {SLOTS.map((kind) => (
        <PhotoSlot
          key={kind}
          kind={kind}
          customerId={customerId}
          customerName={customerName}
          photo={photos[kind]}
        />
      ))}
    </div>
  );
}

function PhotoSlot({
  kind,
  customerId,
  customerName,
  photo,
}: {
  kind: PhotoKind;
  customerId: string;
  customerName: string;
  photo: PhotoSlotValue | null;
}) {
  const t = useTranslations("admin.customers.detail");
  const tc = useTranslations("common");
  const router = useRouter();
  const fmt = createAppFormatters(useFormatter());
  const [replacing, setReplacing] = useState(false);
  const [pending, startTransition] = useTransition();
  const label = t(kind === "STORE" ? "storePhoto" : "parkingPhoto");
  const testId = kind === "STORE" ? "photo-slot-store" : "photo-slot-parking";

  function save(image: UploadedImage) {
    startTransition(async () => {
      let result;
      try {
        result = await addCustomerPhotoAction({
          customerId,
          kind,
          storageKey: image.storageKey,
          width: image.width,
          height: image.height,
        });
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      if (!result.ok) return void toast.error(t(`photoErrors.${result.error}`));
      toast.success(t("photoSaved"));
      setReplacing(false);
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{label}</h3>
        {photo ? (
          <Badge variant="success">
            <CheckCircle2Icon aria-hidden />
            {t("photoPresent")}
          </Badge>
        ) : (
          <Badge variant="warning">
            <ImageOffIcon aria-hidden />
            {t("photoMissing")}
          </Badge>
        )}
      </div>

      {photo ? (
        <ImagePreview
          src={photo.url}
          alt={`${label}: ${customerName}`}
          className="aspect-[4/3] w-full bg-muted"
        />
      ) : null}

      {photo?.driverName && photo.createdAt ? (
        <p
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="photo-by-driver"
        >
          <TruckIcon className="size-4 shrink-0" aria-hidden />
          {t("photoByDriver", {
            name: photo.driverName,
            date: fmt.dateTime(new Date(photo.createdAt)),
          })}
        </p>
      ) : null}

      {photo && !replacing ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setReplacing(true)}
          data-testid="photo-replace"
        >
          <RefreshCwIcon aria-hidden />
          {t("photoReplace")}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <ImageUploader purpose="customer-photo" camera disabled={pending} onUploaded={save} />
          {photo ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setReplacing(false)}
              disabled={pending}
            >
              {tc("actions.cancel")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
