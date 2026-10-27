import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProductRow } from "@/server/products";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import fragment from "../../../tests/fixtures/locale/admin-forms.json";
import { ProductsTable } from "./products-table";

type Tree = Record<string, unknown>;

const moveProductAction = vi.fn(async () => ({ ok: true }));
const setProductActiveAction = vi.fn(async () => ({ ok: true }));
const refresh = vi.fn();

vi.mock("@/server/product-actions", () => ({
  moveProductAction: (...args: unknown[]) => moveProductAction(...(args as [])),
  setProductActiveAction: (...args: unknown[]) => setProductActiveAction(...(args as [])),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string | { pathname: string };
    children: ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : href.pathname} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = out[key];
    out[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object"
        ? merge(current as Tree, value as Tree)
        : value;
  }
  return out;
}

// The fragment is merged by the orchestrator; the test does the same so keys resolve here.
const LOCALES: Record<string, AbstractIntlMessages> = {
  de: merge(de as unknown as Tree, fragment.de as unknown as Tree) as AbstractIntlMessages,
  "zh-Hans": merge(
    zhHans as unknown as Tree,
    fragment["zh-Hans"] as unknown as Tree,
  ) as AbstractIntlMessages,
};

const rows: ProductRow[] = [
  {
    id: "p1",
    sku: "SPA-500",
    unit: "PACK",
    active: true,
    name: {
      de: "Spaghetti 5 kg",
      "zh-Hans": "意大利面 5 公斤",
    },
  } as unknown as ProductRow,
  {
    id: "p2",
    sku: "PEN-500",
    unit: "KG",
    active: false,
    name: {
      de: "Penne 5 kg",
      "zh-Hans": "通心粉 5 公斤",
    },
  } as unknown as ProductRow,
];

function renderTable() {
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={LOCALES.de}
      onError={(error) => {
        throw error;
      }}
    >
      <ProductsTable rows={rows} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProductsTable", () => {
  it("shows the German name with the Simplified name muted underneath and keeps the row ids", () => {
    renderTable();
    const first = screen.getAllByTestId("product-row")[0];
    expect(within(first).getByText("Spaghetti 5 kg")).toBeInTheDocument();
    expect(within(first).getByText("意大利面 5 公斤")).toBeInTheDocument();
    expect(first).toHaveAttribute("data-sku", "SPA-500");
    expect(screen.getByTestId("products-table")).toBeInTheDocument();
  });

  it("deactivates only after the confirm dialog and calls the same action", async () => {
    renderTable();
    const first = screen.getAllByTestId("product-row")[0];
    fireEvent.click(within(first).getByTestId("product-status"));
    expect(setProductActiveAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-submit"));
    await vi.waitFor(() => expect(setProductActiveAction).toHaveBeenCalledWith("p1", false));
  });

  it("reactivates an inactive product without a dialog", async () => {
    renderTable();
    const second = screen.getAllByTestId("product-row")[1];
    fireEvent.click(within(second).getByTestId("product-status"));
    await vi.waitFor(() => expect(setProductActiveAction).toHaveBeenCalledWith("p2", true));
    expect(screen.queryByTestId("confirm-submit")).not.toBeInTheDocument();
  });

  it("keeps the up/down reorder controls wired to the existing action", async () => {
    renderTable();
    const [first, second] = screen.getAllByTestId("product-row");
    // The first row cannot move up and the last cannot move down — the boundary rows stay disabled.
    expect(within(first).getByTestId("move-up")).toBeDisabled();
    expect(within(second).getByTestId("move-down")).toBeDisabled();
    fireEvent.click(within(second).getByTestId("move-up"));
    await vi.waitFor(() => expect(moveProductAction).toHaveBeenCalledWith("p2", "up"));
  });

  it("moves a middle row down with the arrow control", async () => {
    renderTable();
    const first = screen.getAllByTestId("product-row")[0];
    fireEvent.click(within(first).getByTestId("move-down"));
    await vi.waitFor(() => expect(moveProductAction).toHaveBeenCalledWith("p1", "down"));
  });
});
