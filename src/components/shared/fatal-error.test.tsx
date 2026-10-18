import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import fatalMessages from "../../lib/fatal-messages.json";
import { FatalError, fatalLocale } from "./fatal-error";

vi.mock("@/lib/monitoring-client", () => ({ reportClientError: () => {} }));

describe("fatal-messages.json", () => {
  it("is in sync with the message files (pnpm i18n:build regenerates it)", () => {
    expect(fatalMessages).toEqual({
      de: de.errorPages.fatal,
      "zh-Hans": zhHans.errorPages.fatal,
      "zh-Hant-HK": zhHantHK.errorPages.fatal,
      "zh-Hant-TW": zhHantTW.errorPages.fatal,
    });
  });
});

describe("fatalLocale", () => {
  it("takes the first URL segment, German otherwise", () => {
    expect(fatalLocale("/zh-Hant-TW/driver")).toBe("zh-Hant-TW");
    expect(fatalLocale("/zh-Hans")).toBe("zh-Hans");
    expect(fatalLocale("/")).toBe("de");
    expect(fatalLocale("/fr/x")).toBe("de");
    expect(fatalLocale("/__proto__/x")).toBe("de");
  });
});

describe("FatalError", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("renders a calm message and a reload button, never the error text", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<FatalError error={new Error("kaboom")} />);
    const root = screen.getByTestId("fatal-error");
    expect(root).toHaveTextContent(fatalMessages.de.title);
    expect(root).toHaveTextContent(fatalMessages.de.retry);
    expect(root).not.toHaveTextContent("kaboom");
  });
});
