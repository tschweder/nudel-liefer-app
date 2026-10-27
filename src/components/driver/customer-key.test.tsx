import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { KeyChip, type KeyStop } from "./customer-key";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/offline/outbox-browser", () => ({ enqueueMutation: mocks.enqueue }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  en,
  "sr-Latn": srLatn,
  cs,
  "zh-Hans": zhHans,
};

const base: KeyStop = { id: "s1", customerName: "Trattoria Roma", hasKey: null, keyNumber: null };

function renderChip(locale: string, stop: KeyStop, interactive = true) {
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
      <KeyChip stop={stop} interactive={interactive} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockResolvedValue({ clientMutationId: "m1" });
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("KeyChip in %s", (locale) => {
  it("shows '?' for an unknown key and opens the sheet", () => {
    renderChip(locale, base);
    const chip = screen.getByTestId("key-chip");
    expect(chip).toHaveAttribute("data-key", "unknown");
    expect(chip).toHaveTextContent("?");
    fireEvent.click(chip);
    expect(screen.getByTestId("key-sheet")).toBeInTheDocument();
  });

  it("queues 'yes + number' as a key mutation for the stop", async () => {
    renderChip(locale, base);
    fireEvent.click(screen.getByTestId("key-chip"));
    const sheet = within(screen.getByTestId("key-sheet"));
    expect(sheet.getByTestId("key-save")).toBeDisabled();
    fireEvent.click(sheet.getByTestId("key-yes"));
    // "Yes" without a number cannot be saved
    expect(sheet.getByTestId("key-save")).toBeDisabled();
    fireEvent.change(sheet.getByTestId("key-number"), { target: { value: "  A-17 " } });
    fireEvent.click(sheet.getByTestId("key-save"));
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: "key",
      stopId: "s1",
      hasKey: true,
      keyNumber: "A-17",
      customerName: "Trattoria Roma",
    });
    await waitFor(() => expect(screen.queryByTestId("key-sheet")).not.toBeInTheDocument());
    expect(mocks.toast.success).toHaveBeenCalled();
  });

  it("queues 'no' without a number", async () => {
    renderChip(locale, base);
    fireEvent.click(screen.getByTestId("key-chip"));
    const sheet = within(screen.getByTestId("key-sheet"));
    fireEvent.click(sheet.getByTestId("key-no"));
    expect(sheet.queryByTestId("key-number")).not.toBeInTheDocument();
    fireEvent.click(sheet.getByTestId("key-save"));
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.enqueue.mock.calls[0]![0]).toEqual({
      type: "key",
      stopId: "s1",
      hasKey: false,
      customerName: "Trattoria Roma",
    });
  });

  it("shows the number and opens prefilled to correct it", async () => {
    renderChip(locale, { ...base, hasKey: true, keyNumber: "17" });
    const chip = screen.getByTestId("key-chip");
    expect(chip).toHaveAttribute("data-key", "number");
    expect(chip).toHaveTextContent("17");
    fireEvent.click(chip);
    const sheet = within(screen.getByTestId("key-sheet"));
    expect(sheet.getByTestId("key-number")).toHaveValue("17");
    fireEvent.change(sheet.getByTestId("key-number"), { target: { value: "71" } });
    fireEvent.click(sheet.getByTestId("key-save"));
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.enqueue.mock.calls[0]![0]).toMatchObject({ hasKey: true, keyNumber: "71" });
  });

  it("tells the driver when the device could not store the entry", async () => {
    mocks.enqueue.mockRejectedValue(new Error("no storage"));
    renderChip(locale, base);
    fireEvent.click(screen.getByTestId("key-chip"));
    const sheet = within(screen.getByTestId("key-sheet"));
    fireEvent.click(sheet.getByTestId("key-no"));
    fireEvent.click(sheet.getByTestId("key-save"));
    expect(await sheet.findByTestId("key-error")).toBeInTheDocument();
    expect(screen.getByTestId("key-sheet")).toBeInTheDocument();
  });

  it("is display only inside a link row", () => {
    renderChip(locale, { ...base, hasKey: true, keyNumber: "5" }, false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("key-chip")).toHaveTextContent("5");
  });
});

describe("KeyChip states", () => {
  it.each([
    [{ hasKey: false, keyNumber: null }, "none", "–"],
    [{ hasKey: true, keyNumber: null }, "present", "✓"],
    [{ hasKey: true, keyNumber: "9" }, "number", "9"],
  ])("renders %j", (key, kind, text) => {
    renderChip("de", { ...base, ...key });
    expect(screen.getByTestId("key-chip")).toHaveAttribute("data-key", kind);
    expect(screen.getByTestId("key-chip")).toHaveTextContent(text);
  });

  it("renders nothing for a stop without key information", () => {
    const { container } = renderChip("de", { id: "s1", customerName: "x" });
    expect(container).toBeEmptyDOMElement();
  });

  it("has a 48 px touch target", () => {
    renderChip("de", base);
    expect(screen.getByTestId("key-chip").className).toMatch(/min-h-12/);
    expect(screen.getByTestId("key-chip").className).toMatch(/min-w-12/);
  });
});
