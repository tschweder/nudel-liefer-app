import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRecurringOrderAction } from "@/server/recurring-actions";

import de from "../../../messages/de.json";
import { OrderRecurringDialog } from "./order-recurring-dialog";

// jsdom has no ResizeObserver; the Radix dialog/popover measure themselves with it.
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

type DialogProps = Partial<Parameters<typeof OrderRecurringDialog>[0]>;

function renderDialog(props: DialogProps = {}) {
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

/** Last payload handed to the create action. */
function lastInput() {
  return vi.mocked(createRecurringOrderAction).mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function previewDates() {
  return screen
    .getAllByTestId("order-recurring-preview-row")
    .map((row) => row.getAttribute("data-date"));
}

function openMoreOptions() {
  const toggle = screen.getByTestId("order-recurring-more-options");
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderRecurringDialog (NUD-166, NUD-171)", () => {
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
    expect(lastInput()).toMatchObject({
      customerId: "c-1",
      weekdays: [2, 4],
      monthlyRules: [],
      everyNWeeks: 2,
      anchorDate: "2099-05-05",
      seasonFrom: null,
      seasonTo: null,
      exceptions: ["2099-05-05"],
      skipFrom: null,
      skipTo: null,
      windowFromTime: null,
      windowToTime: null,
      endsOn: null,
      maxDeliveries: null,
      dayItems: [],
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
    expect(lastInput()).toMatchObject({ exceptions: [] });
  });

  it("refuses to save without a delivery day and offers the monthly pattern instead", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderDialog();
    fireEvent.click(screen.getByTestId("order-recurring-weekday-2"));
    fireEvent.click(screen.getByTestId("order-recurring-save"));

    expect(screen.getByTestId("order-recurring-error")).toHaveTextContent(
      "Bitte mindestens einen Liefertag",
    );
    expect(screen.getByTestId("order-recurring-error")).toHaveAttribute("data-code", "pattern");
    expect(createRecurringOrderAction).not.toHaveBeenCalled();

    // A monthly pattern alone is a valid rule (union of all patterns).
    fireEvent.click(screen.getByTestId("order-recurring-preset-monthly"));
    fireEvent.click(screen.getByTestId("order-recurring-save"));
    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput()).toMatchObject({
      weekdays: [],
      monthlyRules: [{ kind: "dayOfMonth", day: 1 }],
    });
  });

  it("sets days and rhythm with the preset chips (and stays freely editable)", () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("order-recurring-preset-daily"));
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      expect(screen.getByTestId(`order-recurring-weekday-${day}`)).toBeChecked();
    }
    expect(screen.getByTestId("order-recurring-every")).toHaveValue(1);

    fireEvent.click(screen.getByTestId("order-recurring-preset-biweekly"));
    expect(screen.getByTestId("order-recurring-weekday-1")).toBeChecked();
    expect(screen.getByTestId("order-recurring-weekday-2")).not.toBeChecked();
    expect(screen.getByTestId("order-recurring-every")).toHaveValue(2);

    // No mode: the days stay editable after a preset.
    fireEvent.click(screen.getByTestId("order-recurring-weekday-3"));
    expect(screen.getByTestId("order-recurring-weekday-3")).toBeChecked();
  });

  it("adds and removes a monthly chip and sends the union pattern", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderDialog();

    fireEvent.click(screen.getByTestId("order-recurring-monthly-chip-day-1"));
    expect(screen.getByTestId("order-recurring-monthly-applied")).toHaveTextContent(
      "jeder 1. des Monats",
    );
    // The same rule cannot be added twice.
    expect(screen.getByTestId("order-recurring-monthly-chip-day-1")).toBeDisabled();

    fireEvent.click(screen.getByTestId("order-recurring-monthly-remove-0"));
    expect(screen.queryByTestId("order-recurring-monthly-applied")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("order-recurring-monthly-chip-last-friday"));
    fireEvent.click(screen.getByTestId("order-recurring-save"));

    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput()).toMatchObject({
      // The weekly day stays: the delivery days are the union of all patterns.
      weekdays: [2],
      monthlyRules: [{ kind: "nthWeekday", nth: -1, weekday: 5 }],
    });
  });

  it("shows own rows only for selected days and sends them as dayItems", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderDialog();

    // Only Tuesday is selected, so only Tuesday has a card.
    expect(screen.getByTestId("order-recurring-day-card-2")).toBeInTheDocument();
    expect(screen.queryByTestId("order-recurring-day-card-3")).not.toBeInTheDocument();
    // Without own rows the day shows the base list.
    expect(screen.getByTestId("order-recurring-day-state-2")).toHaveTextContent("wie Basis");
    fireEvent.click(screen.getByTestId("order-recurring-day-toggle-2"));
    expect(screen.getByTestId("order-recurring-day-base-2")).toHaveTextContent("Nudeln (Kiste)");

    fireEvent.click(screen.getByTestId("order-recurring-day-own-2"));
    const quantities = screen.getAllByTestId("order-recurring-day-line-2-quantity");
    expect(quantities).toHaveLength(2);
    fireEvent.change(quantities[0]!, { target: { value: "7" } });
    fireEvent.click(screen.getAllByTestId("order-recurring-day-line-2-remove")[1]!);
    expect(screen.getByTestId("order-recurring-day-state-2")).toHaveTextContent("1 eigene Zeile");

    fireEvent.click(screen.getByTestId("order-recurring-save"));
    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput()).toMatchObject({
      lines: [
        { productId: "p-crate", quantity: 2 },
        { productId: "p-pack", quantity: 1 },
      ],
      dayItems: [{ weekday: 2, productId: "p-crate", quantity: 7 }],
    });
  });

  it("keeps a day without own rows on the base list", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderDialog();

    fireEvent.click(screen.getByTestId("order-recurring-day-own-2"));
    fireEvent.click(screen.getByTestId("order-recurring-day-reset-2"));
    expect(screen.getByTestId("order-recurring-day-state-2")).toHaveTextContent("wie Basis");

    fireEvent.click(screen.getByTestId("order-recurring-save"));
    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput()).toMatchObject({ dayItems: [] });
  });

  it("turns the three end choices into endsOn or maxDeliveries", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderDialog();
    openMoreOptions();

    fireEvent.click(screen.getByTestId("order-recurring-end-date"));
    expect(screen.getByTestId("order-recurring-end-date")).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByTestId("order-recurring-ends-on"), {
      target: { value: "2099-06-30" },
    });
    fireEvent.click(screen.getByTestId("order-recurring-save"));
    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput()).toMatchObject({ endsOn: "2099-06-30", maxDeliveries: null });

    cleanup();
    vi.clearAllMocks();
    renderDialog();
    openMoreOptions();
    fireEvent.click(screen.getByTestId("order-recurring-end-count"));
    fireEvent.change(screen.getByTestId("order-recurring-max-deliveries"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByTestId("order-recurring-save"));
    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput()).toMatchObject({ endsOn: null, maxDeliveries: 12 });
  });

  it("rejects an end date before the start day", () => {
    renderDialog();
    openMoreOptions();
    fireEvent.click(screen.getByTestId("order-recurring-end-date"));
    fireEvent.change(screen.getByTestId("order-recurring-ends-on"), {
      target: { value: "2099-01-01" },
    });
    fireEvent.click(screen.getByTestId("order-recurring-save"));

    expect(screen.getByTestId("order-recurring-error")).toHaveAttribute("data-code", "endsOn");
    expect(createRecurringOrderAction).not.toHaveBeenCalled();
  });

  it("asks for the value of the chosen end condition", () => {
    renderDialog();
    openMoreOptions();

    fireEvent.click(screen.getByTestId("order-recurring-end-count"));
    fireEvent.click(screen.getByTestId("order-recurring-save"));
    expect(screen.getByTestId("order-recurring-error")).toHaveAttribute(
      "data-code",
      "maxDeliveries",
    );

    fireEvent.click(screen.getByTestId("order-recurring-end-date"));
    fireEvent.click(screen.getByTestId("order-recurring-save"));
    expect(screen.getByTestId("order-recurring-error")).toHaveAttribute("data-code", "endsOn");
    expect(createRecurringOrderAction).not.toHaveBeenCalled();
  });

  it("copies the delivery window and the season into the payload", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderDialog();
    openMoreOptions();

    fireEvent.change(screen.getByTestId("order-recurring-window-from"), {
      target: { value: "08:00" },
    });
    fireEvent.change(screen.getByTestId("order-recurring-window-to"), {
      target: { value: "11:30" },
    });
    fireEvent.click(screen.getByTestId("order-recurring-season"));
    fireEvent.change(screen.getByTestId("order-recurring-season-from-month"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByTestId("order-recurring-season-to-month"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByTestId("order-recurring-save"));

    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput()).toMatchObject({
      windowFromTime: "08:00",
      windowToTime: "11:30",
      seasonFrom: "10-01",
      seasonTo: "03-31",
    });
  });

  it("refuses a window whose end is not after its start", () => {
    renderDialog();
    openMoreOptions();
    fireEvent.change(screen.getByTestId("order-recurring-window-from"), {
      target: { value: "12:00" },
    });
    fireEvent.change(screen.getByTestId("order-recurring-window-to"), {
      target: { value: "08:00" },
    });
    fireEvent.click(screen.getByTestId("order-recurring-save"));

    expect(screen.getByTestId("order-recurring-error")).toHaveAttribute("data-code", "window");
    expect(createRecurringOrderAction).not.toHaveBeenCalled();
  });

  it("adds single days and one range in the calendar popover", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderDialog();
    openMoreOptions();
    // The entered order day is skipped by default; unchecked here so the exceptions are explicit.
    fireEvent.click(screen.getByTestId("order-recurring-skip-day"));

    fireEvent.click(screen.getByTestId("order-recurring-exceptions-open"));
    expect(screen.getByTestId("order-recurring-exceptions-popover")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("order-recurring-calendar-day-2099-05-10"));
    fireEvent.click(screen.getByTestId("order-recurring-calendar-day-2099-05-20"));
    expect(screen.getByTestId("order-recurring-exceptions")).toHaveTextContent("2");

    fireEvent.change(screen.getByTestId("order-recurring-skip-from"), {
      target: { value: "2099-07-01" },
    });
    fireEvent.change(screen.getByTestId("order-recurring-skip-to"), {
      target: { value: "2099-07-14" },
    });

    fireEvent.click(screen.getByTestId("order-recurring-save"));
    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput()).toMatchObject({
      exceptions: ["2099-05-10", "2099-05-20"],
      skipFrom: "2099-07-01",
      skipTo: "2099-07-14",
    });
  });

  it("previews the next five delivery dates and follows a pattern change", () => {
    renderDialog();
    // Tuesday, so the five Tuesdays from the start day.
    expect(previewDates()).toHaveLength(5);
    expect(previewDates()).toEqual([
      "2099-05-05",
      "2099-05-12",
      "2099-05-19",
      "2099-05-26",
      "2099-06-02",
    ]);
    expect(screen.getAllByTestId("order-recurring-preview-row")[0]).toHaveTextContent(
      "Nudeln (Kiste)",
    );

    fireEvent.click(screen.getByTestId("order-recurring-preset-daily"));
    expect(previewDates()).toEqual([
      "2099-05-05",
      "2099-05-06",
      "2099-05-07",
      "2099-05-08",
      "2099-05-09",
    ]);
  });

  it("previews the quantities of a day's own rows", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("order-recurring-day-own-2"));
    fireEvent.change(screen.getAllByTestId("order-recurring-day-line-2-quantity")[0]!, {
      target: { value: "9" },
    });

    const firstRow = screen.getAllByTestId("order-recurring-preview-row")[0]!;
    expect(firstRow).toHaveTextContent("9");
    expect(firstRow).not.toHaveTextContent("2 Nudeln (Kiste)");
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
