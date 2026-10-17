import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHantTw from "../../../messages/zh-Hant-TW.json";
import { HomeContent } from "./home-content";

vi.mock("@/server/locale-actions", () => ({ setLocaleAction: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("HomeContent", () => {
  afterEach(cleanup);

  it("renders German messages", () => {
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <HomeContent />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("Nudel Liefer App");
    expect(screen.getByText("Platzhalter")).toBeInTheDocument();
  });

  it("renders Traditional Chinese (TW) messages and labels languages in their own script", () => {
    render(
      <NextIntlClientProvider locale="zh-Hant-TW" messages={zhHantTw}>
        <HomeContent />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("麵條配送應用");
    expect(screen.getByRole("option", { name: "繁體中文（台灣）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Deutsch" })).toBeInTheDocument();
  });
});
