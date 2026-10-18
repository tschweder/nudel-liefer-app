import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { StopStatusActions } from "./stop-status-actions";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  undo: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  outbox: {
    userId: "u1",
    entries: [] as unknown[],
    inFlight: new Set<string>(),
    notices: [],
    flushing: false,
    failure: null,
    confirmed: {},
  },
}));
vi.mock("@/lib/offline/outbox-browser", () => ({
  enqueueMutation: mocks.enqueue,
  undoStopStatus: mocks.undo,
  useOutbox: () => mocks.outbox,
}));
vi.mock("@/lib/offline/browser", () => ({ requestOfflineSync: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};

type StopProps = Parameters<typeof StopStatusActions>[0]["stop"];
const pendingStop: StopProps = {
  id: "s1",
  customerName: "Trattoria Roma",
  status: "PENDING",
  problemReason: null,
  completedAt: null,
};
const tourOf = (...statuses: string[]) =>
  statuses.map((status, i) => ({ id: `s${i + 1}`, sequence: i + 1, status }));
const queued = (type: string, stopId = "s1", id = "m1") => ({
  clientMutationId: id,
  userId: "u1",
  type,
  stopId,
  createdAt: "2099-07-02T08:00:00.000Z",
  seq: 1,
  customerName: "Trattoria Roma",
});

function renderIn(
  locale: string,
  stop: StopProps = pendingStop,
  tourStatus = "RELEASED",
  props: { tourStops?: ReturnType<typeof tourOf>; offline?: boolean } = {},
) {
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
      <StopStatusActions
        stop={stop}
        tourStops={props.tourStops ?? tourOf("PENDING", "PENDING", "PENDING")}
        tourStatus={tourStatus}
        timezone="Europe/Vienna"
        offline={props.offline}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.outbox.entries = [];
  mocks.outbox.inFlight = new Set();
  mocks.enqueue.mockImplementation(async (m) => ({ clientMutationId: "m1", ...m }));
  mocks.undo.mockResolvedValue("cancelled");
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("StopStatusActions in %s", (locale) => {
  it("queues one delivered tap per double tap, opens the next stop and offers Undo", async () => {
    let finish!: (value: unknown) => void;
    mocks.enqueue.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderIn(locale);
    const button = screen.getByTestId("btn-delivered");
    expect(screen.getByTestId("btn-problem")).toBeVisible();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: "delivered",
      stopId: "s1",
      customerName: "Trattoria Roma",
    });
    await act(async () => finish({ clientMutationId: "m1" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/driver/stops/s2"));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    // Toast with an Undo action; pressing it undoes the stop and goes back to it.
    const [message, options] = mocks.toast.mock.calls[0];
    expect(message).toContain("Trattoria Roma");
    expect(options.action.label).toBeTruthy();
    await act(async () => options.action.onClick());
    expect(mocks.undo).toHaveBeenCalledWith("s1", "Trattoria Roma");
    await waitFor(() => expect(mocks.push).toHaveBeenLastCalledWith("/driver/stops/s1"));
  });

  it("reports a problem with a reason and a free text", async () => {
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-problem"));
    const submit = await screen.findByTestId("problem-submit");
    expect(submit).toBeDisabled(); // a reason is required
    const reasons = within(screen.getByTestId("problem-reasons")).getAllByRole("button");
    expect(reasons).toHaveLength(7);
    fireEvent.click(screen.getByTestId("reason-NO_PARKING"));
    expect(screen.getByTestId("reason-NO_PARKING")).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByTestId("problem-note"), { target: { value: "  Baustelle  " } });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: "problem",
      stopId: "s1",
      customerName: "Trattoria Roma",
      reason: "NO_PARKING",
      note: "Baustelle",
    });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/driver/stops/s2"));
  });

  it("goes to the tour screen after the last stop and offers no undo then", async () => {
    renderIn(locale, pendingStop, "RELEASED", { tourStops: tourOf("PENDING", "DELIVERED") });
    fireEvent.click(screen.getByTestId("btn-delivered"));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/driver"));
    expect(mocks.toast.mock.calls[0][1].action).toBeUndefined();
  });

  it("keeps the buttons usable offline and says the tap is kept on the phone", async () => {
    renderIn(locale, pendingStop, "RELEASED", { offline: true });
    expect(screen.getByTestId("status-offline-notice")).toBeVisible();
    expect(screen.getByTestId("btn-delivered")).toBeEnabled();
    expect(screen.getByTestId("btn-problem")).toBeEnabled();
    fireEvent.click(screen.getByTestId("btn-delivered"));
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
  });

  it("does not navigate and says so when the phone cannot store the tap", async () => {
    mocks.enqueue.mockRejectedValue(new Error("no storage"));
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-delivered"));
    expect(await screen.findByTestId("status-error")).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("shows the result of a completed stop with Undo only inside the window", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T08:04:00Z"));
    const done: StopProps = {
      ...pendingStop,
      status: "PROBLEM",
      problemReason: "NOBODY_THERE",
      completedAt: "2099-07-02T08:00:00Z",
    };
    const view = renderIn(locale, done);
    expect(screen.getByTestId("stop-result")).toHaveAttribute("data-status", "PROBLEM");
    expect(screen.getByTestId("stop-result-text")).toBeVisible();
    expect(screen.getByTestId("undo")).toBeVisible();
    expect(screen.queryByTestId("btn-delivered")).toBeNull();
    view.unmount();
    vi.setSystemTime(new Date("2099-07-02T08:06:00Z"));
    renderIn(locale, done);
    expect(screen.queryByTestId("undo")).toBeNull();
    vi.useRealTimers();
  });

  it("offers no undo once the tour is completed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T08:01:00Z"));
    renderIn(
      locale,
      { ...pendingStop, status: "DELIVERED", completedAt: "2099-07-02T08:00:00Z" },
      "COMPLETED",
    );
    expect(screen.getByTestId("stop-result")).toBeVisible();
    expect(screen.queryByTestId("undo")).toBeNull();
    vi.useRealTimers();
  });

  it("lets a queued completion be taken back at any time, even for the last stop", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T09:30:00Z")); // far outside the 5-minute window
    mocks.outbox.entries = [queued("delivered")];
    renderIn(
      locale,
      { ...pendingStop, status: "DELIVERED", completedAt: "2099-07-02T08:00:00.000Z" },
      "RELEASED",
      { tourStops: tourOf("DELIVERED", "DELIVERED") },
    );
    expect(screen.getByTestId("stop-pending-sync")).toBeVisible();
    expect(screen.getByTestId("undo")).toBeVisible();
    vi.useRealTimers();
  });

  it("does not offer to cancel a completion that a request carries right now", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-07-02T09:30:00Z"));
    mocks.outbox.entries = [queued("delivered")];
    mocks.outbox.inFlight = new Set(["m1"]);
    renderIn(
      locale,
      { ...pendingStop, status: "DELIVERED", completedAt: "2099-07-02T08:00:00.000Z" },
      "RELEASED",
      { tourStops: tourOf("DELIVERED", "PENDING") },
    );
    // Outside the window, and the tap is on its way: nothing to cancel, no "waiting" hint either.
    expect(screen.queryByTestId("undo")).toBeNull();
    expect(screen.queryByTestId("stop-pending-sync")).toBeNull();
    vi.useRealTimers();
  });
});
