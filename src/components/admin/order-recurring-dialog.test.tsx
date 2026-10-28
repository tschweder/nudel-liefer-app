import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRecurringOrderAction } from "@/server/recurring-actions";

import de from "../../../messages/de.json";
import { OrderRecurringDialog } from "./order-recurring-dialog";

// jsdom has no ResizeObserver; the Radix dialog measures itself with it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("@/server/recurring-actions", () => ({
  createRecurringOrderAction: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

function renderDialog(props: Partial<Parameters<typeof OrderRecurringDialog>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider
      locale="de"
      messages={de as unknown as AbstractIntlMessages}
      onError={(error) => {
        throw error;
      }}
    >
      <OrderRecurringDialog
        customerId="c-1"
        customerLabel="K-1 Gasthaus"
        lines={[
          { productId: "p-crate", quantity: 2, label: "Nudeln (Kiste)", unit: "CRATE" },
          { productId: "p-pack", quantity: 1, label: "Nudeln (Sackerl)", unit: "PACK" },
        ]}
        startDate="2099-05-05"
        skipDate="2099-05-05"
        onClose={onClose}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderRecurringDialog (NUD-166)", () => {
  it("takes the products from the order and prefills the weekday of the start day", () => {
    renderDialog();
    expect(screen.getByTestId("order-recurring-lines")).toHaveTextContent("Nudeln (Kiste)");
    expect(screen.getByTestId("order-recurring-lines")).toHaveTextContent("Nudeln (Sackerl)");
    // 2099-05-05 is a Tuesday (ISO 2).
    expect(screen.getByTestId("order-recurring-weekday-2")).toBeChecked();
    expect(screen.getByTestId("order-recurring-weekday-1")).not.toBeChecked();
    expect(screen.getByTestId("order-recurring-anchor")).toHaveValue("2099-05-05");
    expect(screen.getByTestId("order-recurring-skip-day")).toBeChecked();
  });

  it("creates the rule with the typed schedule and leaves the entered day out", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 2 });
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByTestId("order-recurring-weekday-4"));
    fireEvent.change(screen.getByTestId("order-recurring-every"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("order-recurring-save"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createRecurringOrderAction).toHaveBeenCalledWith({
      customerId: "c-1",
      weekdays: [2, 4],
      everyNWeeks: 2,
      anchorDate: "2099-05-05",
      seasonFrom: null,
      seasonTo: null,
      exceptions: ["2099-05-05"],
      lines: [
        { productId: "p-crate", quantity: 2 },
        { productId: "p-pack", quantity: 1 },
      ],
    });
  });

  it("sends no exception when the office does not skip the entered day", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderDialog();

    fireEvent.click(screen.getByTestId("order-recurring-skip-day"));
    fireEvent.click(screen.getByTestId("order-recurring-save"));

    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(vi.mocked(createRecurringOrderAction).mock.calls[0]?.[0]).toMatchObject({
      exceptions: [],
    });
  });

  it("refuses to save without a delivery day", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("order-recurring-weekday-2"));
    fireEvent.click(screen.getByTestId("order-recurring-save"));

    expect(screen.getByTestId("order-recurring-error")).toHaveTextContent(
      "Bitte mindestens einen Liefertag",
    );
    expect(createRecurringOrderAction).not.toHaveBeenCalled();
  });

  it("shows why a rule cannot be created for an archived customer", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({
      ok: false,
      error: "customer_inactive",
    });
    renderDialog();

    fireEvent.click(screen.getByTestId("order-recurring-save"));

    await waitFor(() =>
      expect(screen.getByTestId("order-recurring-error")).toHaveTextContent("archiviert"),
    );
  });
});
