import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./theme-toggle";

const setThemeAction = vi.fn<(theme: string) => Promise<void>>(async () => {});

// The toggle's job is the DOM class plus the persisted choice; the texts come from next-intl and are
// covered by the message tests, so they are stubbed here.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/server/theme-actions", () => ({
  setThemeAction: (theme: string) => setThemeAction(theme),
}));

afterEach(() => {
  // This repo has no Testing Library auto-cleanup, and three tests render the same component.
  cleanup();
  document.documentElement.classList.remove("dark");
  setThemeAction.mockClear();
});

describe("ThemeToggle", () => {
  it("switches light -> dark: the class flips immediately and the choice is persisted", async () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await waitFor(() => expect(setThemeAction).toHaveBeenCalledWith("dark"));
  });

  it("switches dark -> light again", async () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await waitFor(() => expect(setThemeAction).toHaveBeenCalledWith("light"));
  });

  it("is an enabled button with an accessible name in every variant", () => {
    for (const variant of ["icon", "labeled", "row"] as const) {
      const { unmount } = render(<ThemeToggle variant={variant} />);
      const button = screen.getByTestId("theme-toggle");
      expect(button).toBeEnabled();
      // `icon` carries aria-label; `row`/`labeled` are named by their visible text.
      const name = button.getAttribute("aria-label") || button.textContent || "";
      expect(name.trim().length).toBeGreaterThan(0);
      unmount();
    }
  });
});
