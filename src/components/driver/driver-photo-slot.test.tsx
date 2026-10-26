import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShownPhoto } from "@/lib/offline/photo-outbox";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { DriverPhotoSlot } from "./driver-photo-slot";

const { enqueuePhoto, resizeImage } = vi.hoisted(() => ({
  enqueuePhoto: vi.fn(),
  resizeImage: vi.fn(),
}));
vi.mock("@/lib/offline/photo-outbox-browser", () => ({ enqueuePhoto }));
vi.mock("@/lib/upload-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-image")>()),
  resizeImage,
}));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  en,
  "sr-Latn": srLatn,
  cs,
};

const shown = (extra: Partial<ShownPhoto> = {}): ShownPhoto => ({
  id: "p1",
  url: "https://s3.test/a.jpg",
  width: 800,
  height: 600,
  pending: false,
  sent: false,
  ...extra,
});

function renderSlot(locale: string, photo: ShownPhoto | null, kind: "STORE" | "PARKING" = "STORE") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      <DriverPhotoSlot
        kind={kind}
        label="Geschäft"
        alt="Geschäft: Trattoria"
        photo={photo}
        stopId="s1"
        customerId="c1"
        customerName="Trattoria Roma"
      />
    </NextIntlClientProvider>,
  );
}

const file = () => new File(["raw"], "shot.jpg", { type: "image/jpeg" });

/** A slot with the photos card's viewer callback, in German. */
function SlotWithViewer({ onOpen }: { onOpen: () => void }) {
  return (
    <NextIntlClientProvider
      locale="de"
      messages={LOCALES.de}
      onError={(error) => {
        throw error;
      }}
    >
      <DriverPhotoSlot
        kind="STORE"
        label="Eingang"
        alt="Eingang: Trattoria"
        photo={shown()}
        stopId="s1"
        customerId="c1"
        customerName="Trattoria Roma"
        onOpen={onOpen}
      />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  enqueuePhoto.mockReset().mockResolvedValue({});
  resizeImage.mockReset().mockResolvedValue({
    blob: new Blob(["small"], { type: "image/jpeg" }),
    width: 1600,
    height: 1200,
  });
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("photo slot (%s)", (locale) => {
  it("the 'no photo' placeholder offers Take photo directly, opening the rear camera", () => {
    renderSlot(locale, null);
    const placeholder = screen.getByTestId("photo-missing");
    const take = within(placeholder).getByTestId("photo-take-store");
    expect(take.textContent?.trim().length).toBeGreaterThan(0);
    const input = screen.getByTestId("photo-input-store") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(input.getAttribute("capture")).toBe("environment");
    const click = vi.spyOn(input, "click");
    fireEvent.click(take);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("a present photo offers Replace, a pending one shows the waiting badge, a sent one the check", () => {
    const { rerender } = renderSlot(locale, shown());
    expect(screen.queryByTestId("photo-missing")).toBeNull();
    expect(screen.getByTestId("photo-replace-store")).toBeTruthy();
    expect(screen.queryByTestId("photo-pending")).toBeNull();
    cleanup();
    renderSlot(locale, shown({ pending: true }));
    expect(screen.getByTestId("photo-pending")).toBeTruthy();
    cleanup();
    renderSlot(locale, shown({ sent: true }));
    expect(screen.getByTestId("photo-sent")).toBeTruthy();
    void rerender;
  });

  it("opens the shared viewer on tap, but only when the card offers one", () => {
    const onOpen = vi.fn();
    render(<SlotWithViewer onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("photo-open-store"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    cleanup();
    // Without a viewer callback (a standalone slot) the button is inert and disabled.
    renderSlot(locale, shown());
    expect(screen.getByTestId("photo-open-store")).toBeDisabled();
  });
});

describe("capture flow", () => {
  it("shot -> preview -> confirm queues the resized blob for this stop and customer", async () => {
    renderSlot("de", null, "PARKING");
    const input = screen.getByTestId("photo-input-parking");
    fireEvent.change(input, { target: { files: [file()] } });
    await waitFor(() => expect(screen.getByTestId("photo-preview")).toBeTruthy());
    expect(resizeImage).toHaveBeenCalledTimes(1);
    expect(enqueuePhoto).not.toHaveBeenCalled(); // nothing is saved before the driver confirms
    fireEvent.click(screen.getByTestId("photo-confirm"));
    await waitFor(() => expect(enqueuePhoto).toHaveBeenCalledTimes(1));
    expect(enqueuePhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        stopId: "s1",
        customerId: "c1",
        customerName: "Trattoria Roma",
        kind: "PARKING",
        width: 1600,
        height: 1200,
        blob: expect.any(Blob),
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("photo-preview")).toBeNull());
  });

  it("cancel throws the shot away without queueing", async () => {
    renderSlot("de", shown());
    fireEvent.change(screen.getByTestId("photo-input-store"), { target: { files: [file()] } });
    await waitFor(() => expect(screen.getByTestId("photo-preview")).toBeTruthy());
    fireEvent.click(screen.getByTestId("photo-cancel"));
    expect(screen.queryByTestId("photo-preview")).toBeNull();
    expect(enqueuePhoto).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("an unreadable file shows an error and keeps the placeholder", async () => {
    const { UploadError } = await import("@/lib/upload-image");
    resizeImage.mockRejectedValueOnce(new UploadError("DECODE_FAILED"));
    renderSlot("de", null);
    fireEvent.change(screen.getByTestId("photo-input-store"), { target: { files: [file()] } });
    await waitFor(() => expect(screen.getByTestId("photo-error")).toBeTruthy());
    expect(screen.getByTestId("photo-take-store")).toBeTruthy();
    expect(enqueuePhoto).not.toHaveBeenCalled();
  });

  it("tells the driver when the device cannot keep the photo", async () => {
    enqueuePhoto.mockRejectedValueOnce(new Error("quota"));
    renderSlot("de", null);
    fireEvent.change(screen.getByTestId("photo-input-store"), { target: { files: [file()] } });
    await waitFor(() => expect(screen.getByTestId("photo-confirm")).toBeTruthy());
    fireEvent.click(screen.getByTestId("photo-confirm"));
    await waitFor(() => expect(screen.getByTestId("photo-error")).toBeTruthy());
    expect(screen.getByTestId("photo-error").textContent).toContain("Gerät");
  });
});
