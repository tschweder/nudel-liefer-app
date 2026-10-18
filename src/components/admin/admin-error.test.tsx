import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import { AdminError } from "./admin-error";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/monitoring-client", () => ({ reportClientError: () => {} }));

function renderIn(locale: "de" | "zh-Hans", error: Error & { digest?: string }, reset = vi.fn()) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "de" ? de : zhHans}
      onError={(e) => {
        throw e;
      }}
    >
      <AdminError error={error} reset={reset} />
    </NextIntlClientProvider>,
  );
  return reset;
}

describe("AdminError", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the reference id but never the error message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("secret internal detail"), { digest: "1234567890" });
    const reset = renderIn("de", error);
    expect(screen.getByTestId("admin-error")).not.toHaveTextContent("secret internal detail");
    expect(screen.getByTestId("admin-error-reference")).toHaveTextContent("Fehler-ID: 1234567890");
    fireEvent.click(screen.getByRole("button"));
    expect(reset).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("is localized and works without a digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderIn("zh-Hans", new Error("x"));
    expect(screen.getByRole("alert")).toHaveTextContent(zhHans.errorPages.admin.title);
    expect(screen.queryByTestId("admin-error-reference")).toBeNull();
  });
});
