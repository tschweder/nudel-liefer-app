import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShownPhoto } from "@/lib/offline/photo-outbox";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { StopPhotos } from "./stop-photos";

vi.mock("@/lib/offline/photo-outbox-browser", () => ({ enqueuePhoto: vi.fn() }));
vi.mock("@/lib/upload-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-image")>()),
  resizeImage: vi.fn(),
}));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};

const photo = (url: string): ShownPhoto => ({
  id: url,
  url,
  width: 800,
  height: 600,
  pending: false,
  sent: false,
});

/** Per-locale words of the viewer, so one test body serves all four message files. */
const WORDS: Record<
  string,
  { store: string; parking: string; next: string; prev: string; close: string }
> = {
  de: {
    store: "Eingang",
    parking: "Parken",
    next: "Nächstes Foto",
    prev: "Vorheriges Foto",
    close: "Schließen",
  },
  "zh-Hans": {
    store: "入口",
    parking: "停车",
    next: "下一张照片",
    prev: "上一张照片",
    close: "关闭",
  },
  "zh-Hant-HK": {
    store: "入口",
    parking: "停車",
    next: "下一張照片",
    prev: "上一張照片",
    close: "關閉",
  },
  "zh-Hant-TW": {
    store: "入口",
    parking: "停車",
    next: "下一張照片",
    prev: "上一張照片",
    close: "關閉",
  },
};

function renderPhotos(locale: string, store: ShownPhoto | null, parking: ShownPhoto | null) {
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
      <StopPhotos
        photos={{ STORE: store, PARKING: parking }}
        customerName="Trattoria Roma"
        stopId="s1"
        customerId="c1"
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("StopPhotos in %s", (locale) => {
  it("shows both slots side by side and keeps the placeholders", () => {
    renderPhotos(locale, photo("https://s3.test/store.jpg"), null);
    const card = screen.getByTestId("stop-photos");
    expect(within(card).getByTestId("photo-store")).toBeVisible();
    expect(within(card).getByTestId("photo-parking")).toBeVisible();
    expect(within(card).getByTestId("photo-label-store")).toHaveTextContent(WORDS[locale]!.store);
    expect(within(card).getByTestId("photo-label-parking")).toHaveTextContent(WORDS[locale]!.parking);
    // No photo in PARKING -> placeholder with its own "take photo" button.
    expect(within(card).getByTestId("photo-take-parking")).toBeVisible();
    expect(within(card).queryByTestId("photo-open-parking")).toBeNull();
  });

  it("opens the fullscreen viewer with zoom, caption, arrow/swipe navigation and a close button", () => {
    renderPhotos(locale, photo("https://s3.test/store.jpg"), photo("https://s3.test/parking.jpg"));
    expect(screen.queryByTestId("photo-viewer")).toBeNull();
    fireEvent.click(screen.getByTestId("photo-open-store"));

    const viewer = screen.getByTestId("photo-viewer");
    expect(viewer).toBeVisible();
    // The zoom UI (reused ImagePreview) is there, starting unzoomed.
    expect(screen.getByTestId("zoom-image")).toHaveAttribute("data-scale", "1");
    const caption = screen.getByTestId("photo-viewer-caption");
    expect(caption).toHaveTextContent(WORDS[locale]!.store);
    expect(caption).toHaveTextContent("Trattoria Roma");

    // The arrows step through both photos.
    fireEvent.click(within(viewer).getByRole("button", { name: WORDS[locale]!.next }));
    expect(caption).toHaveTextContent(WORDS[locale]!.parking);
    fireEvent.click(within(viewer).getByRole("button", { name: WORDS[locale]!.prev }));
    expect(caption).toHaveTextContent(WORDS[locale]!.store);

    // A horizontal swipe switches to the neighbouring photo as well.
    const frame = screen.getByTestId("zoom-frame");
    fireEvent.pointerDown(frame, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 210 });
    expect(caption).toHaveTextContent(WORDS[locale]!.parking);

    // The close button leaves the viewer.
    fireEvent.click(screen.getByTestId("photo-viewer-close"));
    expect(screen.queryByTestId("photo-viewer")).toBeNull();
  });

  it("offers an overlay button to replace a present photo", () => {
    renderPhotos(locale, photo("https://s3.test/store.jpg"), null);
    const replace = screen.getByTestId("photo-replace-store");
    const input = screen.getByTestId("photo-input-store") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(replace);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
