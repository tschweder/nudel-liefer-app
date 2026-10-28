import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScheduleDay } from "@/domain/work-time";

import de from "../../../messages/de.json";
import { ScheduleSummary, WorkScheduleDialog } from "./work-schedule-editor";

const saveWorkScheduleAction = vi.fn<(input: unknown) => Promise<{ ok: true }>>(async () => ({
  ok: true,
}));

vi.mock("@/server/work-schedule-actions", () => ({
  saveWorkScheduleAction: (input: unknown) => saveWorkScheduleAction(input),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MESSAGES = de as unknown as AbstractIntlMessages;

const WEEK: ScheduleDay[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinutes: 6 * 60,
  endMinutes: 14 * 60,
  active: true,
}));

function renderIn(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={MESSAGES}
      onError={(error) => {
        throw error;
      }}
    >
      {node}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScheduleSummary", () => {
  it("compresses consecutive weekdays with the same hours into one run", () => {
    renderIn(<ScheduleSummary schedule={WEEK} />);
    expect(screen.getByTestId("driver-schedule")).toHaveTextContent("Montag–Freitag 06:00–14:00");
  });

  it("lists split weeks separately and says when no working time is maintained", () => {
    const split: ScheduleDay[] = [
      { weekday: 1, startMinutes: 360, endMinutes: 840, active: true },
      { weekday: 3, startMinutes: 480, endMinutes: 960, active: true },
      { weekday: 5, startMinutes: 360, endMinutes: 840, active: false },
    ];
    renderIn(<ScheduleSummary schedule={split} />);
    expect(screen.getByTestId("driver-schedule")).toHaveTextContent(
      "Montag 06:00–14:00, Mittwoch 08:00–16:00",
    );
    cleanup();
    renderIn(<ScheduleSummary schedule={[]} />);
    expect(screen.getByText("Keine Arbeitszeit hinterlegt")).toBeInTheDocument();
  });
});

describe("WorkScheduleDialog", () => {
  it("sends every weekday with its hours and the on/off state", async () => {
    renderIn(
      <WorkScheduleDialog
        driverId="d1"
        driverName="Hans"
        days={WEEK}
        open
        onOpenChange={() => undefined}
      />,
    );
    // Friday is switched off; the stored hours stay in the payload.
    await fireEvent.click(screen.getByTestId("schedule-day-5"));
    await fireEvent.change(screen.getByTestId("schedule-start-1"), {
      target: { value: "05:30" },
    });
    await fireEvent.click(screen.getByTestId("schedule-save"));

    await waitFor(() => expect(saveWorkScheduleAction).toHaveBeenCalledTimes(1));
    expect(saveWorkScheduleAction).toHaveBeenCalledWith({
      driverId: "d1",
      days: [
        { weekday: 1, active: true, start: "05:30", end: "14:00" },
        { weekday: 2, active: true, start: "06:00", end: "14:00" },
        { weekday: 3, active: true, start: "06:00", end: "14:00" },
        { weekday: 4, active: true, start: "06:00", end: "14:00" },
        { weekday: 5, active: false, start: "06:00", end: "14:00" },
        { weekday: 6, active: false, start: "06:00", end: "14:00" },
        { weekday: 7, active: false, start: "06:00", end: "14:00" },
      ],
    });
  });

  it("refuses an end before the start without calling the server", async () => {
    renderIn(
      <WorkScheduleDialog
        driverId="d1"
        driverName="Hans"
        days={WEEK}
        open
        onOpenChange={() => undefined}
      />,
    );
    await fireEvent.change(screen.getByTestId("schedule-end-1"), { target: { value: "05:00" } });
    await fireEvent.click(screen.getByTestId("schedule-save"));
    expect(screen.getByTestId("schedule-error")).toHaveTextContent(
      "Bitte Beginn und Ende prüfen: das Ende muss nach dem Beginn liegen.",
    );
    expect(saveWorkScheduleAction).not.toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    renderIn(
      <WorkScheduleDialog
        driverId="d1"
        driverName="Hans"
        days={WEEK}
        open={false}
        onOpenChange={() => undefined}
      />,
    );
    expect(screen.queryByTestId("work-schedule-dialog")).not.toBeInTheDocument();
  });
});
