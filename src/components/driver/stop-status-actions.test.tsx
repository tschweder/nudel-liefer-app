import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StopStatusResult } from "@/server/stop-status";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { StopStatusActions } from "./stop-status-actions";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/server/stop-status-actions", () => ({ stopStatusAction: mocks.action }));
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type StopProps = Parameters<typeof StopStatusActions>[0]["stop"];
const pendingStop: StopProps = {
  id: "s1",
  customerName: "Trattoria Roma",
  status: "PENDING",
  problemReason: null,
  completedAt: null,
};

function renderIn(locale: string, stop: StopProps = pendingStop, tourStatus = "RELEASED") {
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
      <StopStatusActions stop={stop} tourStatus={tourStatus} timezone="Europe/Vienna" />
    </NextIntlClientProvider>,
  );
}

const ok = (extra: Partial<Extract<StopStatusResult, { ok: true }>> = {}): StopStatusResult => ({
  ok: true,
  replayed: false,
  kind: "COMPLETE",
  stopId: "s1",
  status: "DELIVERED",
  tourId: "t1",
  tourStatus: "IN_PROGRESS",
  done: 1,
  total: 3,
  nextStopId: "s2",
  completedAt: "2099-07-02T08:00:00.000Z",
  undoUntil: "2099-07-02T08:05:00.000Z",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.action.mockResolvedValue(ok());
});
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("StopStatusActions in %s", (locale) => {
  it("shows the two big buttons and sends one delivered mutation per double tap", async () => {
    let finish!: (value: StopStatusResult) => void;
    mocks.action.mockReturnValue(new Promise<StopStatusResult>((resolve) => (finish = resolve)));
    renderIn(locale);
    const button = screen.getByTestId("btn-delivered");
    expect(screen.getByTestId("btn-problem")).toBeVisible();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect(mocks.action).toHaveBeenCalledWith({
      type: "delivered",
      stopId: "s1",
      clientMutationId: expect.stringMatching(UUID),
    });
    await act(async () => finish(ok()));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/driver/stops/s2"));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    // Toast with an Undo action; pressing it sends an undo and goes back to the stop.
    const [message, options] = mocks.toast.mock.calls[0];
    expect(message).toContain("Trattoria Roma");
    expect(options.action.label).toBeTruthy();
    mocks.action.mockResolvedValue(ok({ kind: "UNDO", status: "PENDING", undoUntil: null }));
    await act(async () => options.action.onClick());
    expect(mocks.action).toHaveBeenLastCalledWith({
      type: "undo",
      stopId: "s1",
      clientMutationId: expect.stringMatching(UUID),
    });
    await waitFor(() => expect(mocks.push).toHaveBeenLastCalledWith("/driver/stops/s1"));
  });

  it("reports a problem with a reason and a free text", async () => {
    mocks.action.mockResolvedValue(ok({ status: "PROBLEM" }));
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
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1));
    expect(mocks.action).toHaveBeenCalledWith({
      type: "problem",
      stopId: "s1",
      clientMutationId: expect.stringMatching(UUID),
      reason: "NO_PARKING",
      note: "Baustelle",
    });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/driver/stops/s2"));
  });

  it("goes to the tour screen after the last stop and offers no undo then", async () => {
    mocks.action.mockResolvedValue(
      ok({ nextStopId: null, tourStatus: "COMPLETED", undoUntil: null }),
    );
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-delivered"));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/driver"));
    expect(mocks.toast.mock.calls[0][1].action).toBeUndefined();
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

  it("shows a server rejection and refreshes when the screen is stale", async () => {
    mocks.action.mockResolvedValue({ ok: false, error: "already_completed" });
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-delivered"));
    expect(await screen.findByTestId("status-error")).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps the mutation id when no answer came (retry = same mutation)", async () => {
    mocks.action.mockRejectedValueOnce(new Error("offline"));
    renderIn(locale);
    fireEvent.click(screen.getByTestId("btn-delivered"));
    expect(await screen.findByTestId("status-error")).toBeVisible();
    fireEvent.click(screen.getByTestId("btn-delivered"));
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.action.mock.calls.map((c) => c[0].clientMutationId);
    expect(second).toBe(first);
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  });
});
