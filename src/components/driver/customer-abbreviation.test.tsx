import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { AbbreviationChip, type AbbreviationStop } from "./customer-abbreviation";

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

const base: AbbreviationStop = { id: "s1", customerName: "Trattoria Roma", abbreviation: null };

function renderChip(locale: string, stop: AbbreviationStop, interactive = true) {
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
      <AbbreviationChip stop={stop} interactive={interactive} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockResolvedValue({ clientMutationId: "m1" });
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("AbbreviationChip in %s", (locale) => {
  it("shows an add chip while empty and opens the sheet", () => {
    renderChip(locale, base);
    const chip = screen.getByTestId("abbreviation-chip");
    expect(chip).toHaveAttribute("data-abbreviation", "empty");
    fireEvent.click(chip);
    expect(screen.getByTestId("abbreviation-sheet")).toBeInTheDocument();
  });

  it("shows the text and queues a corrected value", async () => {
    renderChip(locale, { ...base, abbreviation: "Ä/ß-#1" });
    const chip = screen.getByTestId("abbreviation-chip");
    expect(chip).toHaveAttribute("data-abbreviation", "set");
    expect(chip).toHaveTextContent("Ä/ß-#1");
    fireEvent.click(chip);
    expect(screen.getByTestId("abbreviation-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("abbreviation-input"), { target: { value: " Q/7 " } });
    fireEvent.click(screen.getByTestId("abbreviation-save"));
    await waitFor(() =>
      expect(mocks.enqueue).toHaveBeenCalledWith({
        type: "abbreviation",
        stopId: "s1",
        abbreviation: "Q/7",
        customerName: "Trattoria Roma",
      }),
    );
  });

  it("queues a clear when the text is emptied", async () => {
    renderChip(locale, { ...base, abbreviation: "A1" });
    fireEvent.click(screen.getByTestId("abbreviation-chip"));
    fireEvent.change(screen.getByTestId("abbreviation-input"), { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("abbreviation-save"));
    await waitFor(() =>
      expect(mocks.enqueue).toHaveBeenCalledWith({
        type: "abbreviation",
        stopId: "s1",
        customerName: "Trattoria Roma",
      }),
    );
  });

  it("is display only in list rows and hidden while empty or unknown", () => {
    const { unmount } = renderChip(locale, { ...base, abbreviation: "A1" }, false);
    expect(screen.getByTestId("abbreviation-chip").tagName).toBe("SPAN");
    unmount();
    renderChip(locale, base, false);
    expect(screen.queryByTestId("abbreviation-chip")).toBeNull();
    cleanup();
    renderChip(locale, { id: "s1", customerName: "x" });
    expect(screen.queryByTestId("abbreviation-chip")).toBeNull();
  });
});
