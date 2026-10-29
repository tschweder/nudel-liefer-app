import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { ParkingSetButton } from "./parking-setter";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/offline/outbox-browser", () => ({ enqueueMutation: mocks.enqueue }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/components/maps/lazy", () => ({
  PinPickerMapLazy: ({
    value,
    fallbackCenter,
    onChange,
  }: {
    value: { lat: number; lng: number } | null;
    fallbackCenter?: { lat: number; lng: number };
    onChange: (next: { lat: number; lng: number }) => void;
  }) => (
    <button
      type="button"
      data-testid="map-stub"
      data-center={fallbackCenter ? `${fallbackCenter.lat},${fallbackCenter.lng}` : ""}
      onClick={() => onChange({ lat: 48.21, lng: 16.37 })}
    >
      {value ? `${value.lat},${value.lng}` : ""}
    </button>
  ),
}));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  en,
  "sr-Latn": srLatn,
  cs,
  "zh-Hans": zhHans,
};

function renderButton(locale: string) {
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
      <ParkingSetButton
        stop={{ id: "s1", customerName: "Trattoria Roma" }}
        tiles={{ url: "x", attribution: "" }}
      />
    </NextIntlClientProvider>,
  );
}

function setGeolocation(impl: unknown) {
  Object.defineProperty(navigator, "geolocation", { value: impl, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockResolvedValue({ clientMutationId: "m1" });
});
afterEach(() => {
  cleanup();
  setGeolocation(undefined);
});

describe.each(Object.keys(LOCALES))("ParkingSetButton in %s", (locale) => {
  it("sets the point on the map, centred on the customer (NUD-181)", async () => {
    render(
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
        <ParkingSetButton
          stop={{ id: "s1", customerName: "Trattoria Roma", lat: 48.2, lng: 16.3 }}
          tiles={{ url: "x", attribution: "" }}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByTestId("parking-set"));
    // the third way exists next to GPS and typed coordinates
    fireEvent.click(screen.getByTestId("parking-mode-map"));
    const map = screen.getByTestId("map-stub");
    // centred on the customer's routing point while no pin exists yet
    expect(map).toHaveAttribute("data-center", "48.2,16.3");
    expect(screen.getByTestId("parking-confirm")).toBeDisabled();
    fireEvent.click(map);
    expect(screen.getByTestId("map-stub")).toHaveTextContent("48.21,16.37");
    expect(screen.getByTestId("parking-confirm")).toBeEnabled();
  });

  it("saves typed coordinates with a comma as 6-decimal numbers", async () => {
    renderButton(locale);
    fireEvent.click(screen.getByTestId("parking-set"));
    expect(screen.getByTestId("parking-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("parking-mode-manual"));
    fireEvent.change(screen.getByTestId("parking-lat"), { target: { value: "48,2082" } });
    fireEvent.change(screen.getByTestId("parking-lng"), { target: { value: "16,3738" } });
    expect(screen.getByTestId("map-stub")).toHaveTextContent("48.2082,16.3738");
    fireEvent.click(screen.getByTestId("parking-confirm"));
    await waitFor(() =>
      expect(mocks.enqueue).toHaveBeenCalledWith({
        type: "parking",
        stopId: "s1",
        lat: 48.2082,
        lng: 16.3738,
        customerName: "Trattoria Roma",
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalled();
  });

  it("refuses out-of-range coordinates", () => {
    renderButton(locale);
    fireEvent.click(screen.getByTestId("parking-set"));
    fireEvent.click(screen.getByTestId("parking-mode-manual"));
    fireEvent.change(screen.getByTestId("parking-lat"), { target: { value: "91" } });
    fireEvent.change(screen.getByTestId("parking-lng"), { target: { value: "16" } });
    expect(screen.getByTestId("parking-range-error")).toBeInTheDocument();
    expect(screen.getByTestId("parking-confirm")).toBeDisabled();
    expect(screen.queryByTestId("map-stub")).toBeNull();
  });

  it("uses the device position and lets the driver confirm it", async () => {
    setGeolocation({
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 48.20821234567, longitude: 16.37381234567 } }),
    });
    renderButton(locale);
    fireEvent.click(screen.getByTestId("parking-set"));
    fireEvent.click(screen.getByTestId("parking-mode-gps"));
    expect(screen.getByTestId("map-stub")).toHaveTextContent("48.208212,16.373812");
    fireEvent.click(screen.getByTestId("parking-confirm"));
    await waitFor(() =>
      expect(mocks.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: "parking", lat: 48.208212, lng: 16.373812 }),
      ),
    );
  });

  it("explains a refused position and switches to typing", () => {
    setGeolocation({
      getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
        fail({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 }),
    });
    renderButton(locale);
    fireEvent.click(screen.getByTestId("parking-set"));
    fireEvent.click(screen.getByTestId("parking-mode-gps"));
    expect(screen.getByTestId("parking-gps-problem")).toHaveAttribute("data-problem", "denied");
    expect(screen.getByTestId("parking-lat")).toBeInTheDocument();
  });

  it("switches to typing when the device has no geolocation", () => {
    renderButton(locale);
    fireEvent.click(screen.getByTestId("parking-set"));
    fireEvent.click(screen.getByTestId("parking-mode-gps"));
    expect(screen.getByTestId("parking-gps-problem")).toHaveAttribute(
      "data-problem",
      "unsupported",
    );
  });
});
