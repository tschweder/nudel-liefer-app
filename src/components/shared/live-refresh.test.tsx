import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveRefresh } from "./live-refresh";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("LiveRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    refresh.mockReset();
  });

  it("refreshes once per interval", () => {
    render(<LiveRefresh intervalMs={30_000} />);
    vi.advanceTimersByTime(29_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does nothing while disabled", () => {
    render(<LiveRefresh intervalMs={1000} enabled={false} />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("pauses while the tab is hidden and refreshes when it becomes visible", () => {
    render(<LiveRefresh intervalMs={1000} />);
    setVisibility("hidden");
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops polling after unmount", () => {
    const { unmount } = render(<LiveRefresh intervalMs={1000} />);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
