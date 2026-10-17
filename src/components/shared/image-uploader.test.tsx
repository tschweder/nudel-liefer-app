import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import { ImagePreview } from "./image-preview";
import { ImageUploader } from "./image-uploader";

const uploadImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/upload-image", async (orig) => ({
  ...(await orig<typeof import("@/lib/upload-image")>()),
  uploadImage,
}));

const wrap = (ui: React.ReactNode, locale = "de", messages: object = de) => (
  <NextIntlClientProvider locale={locale} messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const png = () => new File([new Uint8Array([1])], "p.png", { type: "image/png" });

describe("ImageUploader", () => {
  beforeEach(() => {
    uploadImage.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uploads a file picked via the input and reports the result", async () => {
    uploadImage.mockResolvedValue({ storageKey: "customers/a.jpg", width: 1, height: 1, bytes: 1 });
    const onUploaded = vi.fn();
    render(wrap(<ImageUploader purpose="customer-photo" onUploaded={onUploaded} />));
    fireEvent.change(screen.getByTestId("image-uploader-input"), { target: { files: [png()] } });
    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith(
        expect.objectContaining({ storageKey: "customers/a.jpg" }),
      ),
    );
    expect(uploadImage).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ purpose: "customer-photo" }),
    );
  });

  it("accepts a dropped image and a pasted image", async () => {
    uploadImage.mockResolvedValue({ storageKey: "k", width: 1, height: 1, bytes: 1 });
    render(wrap(<ImageUploader purpose="screenshot" onUploaded={() => {}} />));
    const zone = screen.getByTestId("image-uploader");
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    fireEvent.paste(zone, { clipboardData: { files: [png()] } });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(2));
  });

  it("ignores pasted non-images", () => {
    render(wrap(<ImageUploader purpose="screenshot" onUploaded={() => {}} />));
    fireEvent.paste(screen.getByTestId("image-uploader"), {
      clipboardData: { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
    });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it.each([
    ["de", de, "HEIC-Fotos"],
    ["zh-Hans", zhHans, "HEIC"],
  ])("shows a localized HEIC failure message (%s)", async (locale, messages, text) => {
    // Run the real pipeline: the browser cannot decode this HEIC file.
    uploadImage.mockImplementation(async (file: File) => {
      const actual =
        await vi.importActual<typeof import("@/lib/upload-image")>("@/lib/upload-image");
      return actual.uploadImage(file, { purpose: "customer-photo" });
    });
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("undecodable")));
    const heic = new File([new Uint8Array([1])], "IMG_1.HEIC", { type: "image/heic" });
    render(
      wrap(<ImageUploader purpose="customer-photo" onUploaded={() => {}} />, locale, messages),
    );
    fireEvent.change(screen.getByTestId("image-uploader-input"), { target: { files: [heic] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });
});

describe("ImagePreview", () => {
  afterEach(cleanup);
  it("opens a fullscreen viewer and zooms with the buttons", async () => {
    render(wrap(<ImagePreview src="http://x/a.jpg" alt="Eingang" />));
    fireEvent.click(screen.getByRole("button", { name: /Bild vergrößern/ }));
    const img = await screen.findByTestId("zoom-image");
    expect(img).toHaveAttribute("data-scale", "1");
    fireEvent.click(screen.getByRole("button", { name: "Vergrößern" }));
    expect(screen.getByTestId("zoom-image")).toHaveAttribute("data-scale", "1.5");
    fireEvent.click(screen.getByRole("button", { name: "Zurücksetzen" }));
    expect(screen.getByTestId("zoom-image")).toHaveAttribute("data-scale", "1");
  });
});
