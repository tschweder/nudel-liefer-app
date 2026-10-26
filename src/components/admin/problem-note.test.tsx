import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import type { PlanStop } from "@/server/tour-planning";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { ProblemNote } from "./problem-note";

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  en,
  "sr-Latn": srLatn,
  cs,
};
type Note = NonNullable<PlanStop["problemNote"]>;

const translated: Note = {
  text: "门锁着，没有人开门",
  locale: "zh-Hans",
  german: "Die Tür ist verschlossen, niemand öffnet.",
  germanMachine: true,
  pending: false,
};

function show(note: Note, locale = "de") {
  return render(
    <NextIntlClientProvider locale={locale} messages={LOCALES[locale]}>
      <ProblemNote note={note} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe.each(Object.keys(LOCALES))("ProblemNote (%s)", (ui) => {
  it("shows the German text with a machine marker; the original sits behind a toggle", () => {
    show(translated, ui);
    expect(screen.getByTestId("stop-problem-german")).toHaveTextContent(translated.german!);
    expect(screen.getByTestId("stop-problem-german").querySelector("q")).toHaveAttribute(
      "lang",
      "de",
    );
    expect(screen.getByTestId("stop-problem-machine")).toBeInTheDocument();
    expect(screen.queryByTestId("stop-problem-original")).toBeNull();

    const toggle = screen.getByTestId("stop-problem-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const original = screen.getByTestId("stop-problem-original");
    expect(original).toHaveTextContent(translated.text);
    expect(original.querySelector("q")).toHaveAttribute("lang", "zh-Hans");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("stop-problem-original")).toBeNull();
  });

  it("shows a pending hint and the original while the translation is missing", () => {
    show({ ...translated, german: null, germanMachine: false, pending: true }, ui);
    expect(screen.getByTestId("stop-problem-pending")).toBeInTheDocument();
    expect(screen.getByTestId("stop-problem-original")).toHaveTextContent(translated.text);
    expect(screen.queryByTestId("stop-problem-toggle")).toBeNull();
  });

  it("shows a German note as is, without marker or toggle", () => {
    show(
      { text: "Baustelle", locale: "de", german: null, germanMachine: false, pending: false },
      ui,
    );
    expect(screen.getByTestId("stop-problem-original")).toHaveTextContent("Baustelle");
    expect(screen.queryByTestId("stop-problem-machine")).toBeNull();
    expect(screen.queryByTestId("stop-problem-pending")).toBeNull();
    expect(screen.queryByTestId("stop-problem-toggle")).toBeNull();
  });
});
