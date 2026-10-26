import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type SyncState,SyncStatusChip } from "./sync-status-chip";

const messages = {
  driver: {
    sync: {
      online: "Online",
      preparing: "Wird vorbereitet …",
      offline: "Offline",
      pendingChip: "{count} wartet",
      error: "Sync-Fehler",
    },
  },
};

function renderChip(props: Parameters<typeof SyncStatusChip>[0]) {
  return render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <SyncStatusChip {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SyncStatusChip", () => {
  afterEach(cleanup);

  const states: [SyncState, string][] = [
    ["online", "Online"],
    ["preparing", "Wird vorbereitet …"],
    ["offline", "Offline"],
    ["pending", "3 wartet"],
    ["error", "Sync-Fehler"],
  ];

  it.each(states)("renders the %s state with its text", (state, text) => {
    renderChip({ state, pendingCount: 3 });
    const chip = screen.getByTestId("sync-chip");
    expect(chip).toHaveAttribute("data-state", state);
    expect(chip).toHaveTextContent(text);
  });

  it("is a plain span without a handler and a named button with one", () => {
    const { unmount } = renderChip({ state: "online" });
    expect(screen.getByTestId("sync-chip").tagName).toBe("SPAN");
    unmount();

    const onClick = vi.fn();
    renderChip({ state: "pending", pendingCount: 2, onClick });
    const button = screen.getByRole("button", { name: "2 wartet" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not go negative when the count is missing", () => {
    renderChip({ state: "pending" });
    expect(screen.getByTestId("sync-chip")).toHaveTextContent("0 wartet");
  });
});
