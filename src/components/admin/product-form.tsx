"use client";

import { RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { UNITS } from "@/lib/units";
import {
  createProductAction,
  deriveHantAction,
  updateProductAction,
} from "@/server/product-actions";
import type { ProductFormValues } from "@/server/products";

type Props = {
  /** `null` creates a product; an id edits that product. */
  productId: string | null;
  initial: ProductFormValues;
  /** The unit cannot change once the product is on an order. */
  unitLocked: boolean;
};

const DERIVE_DELAY_MS = 200;

type FormError = "invalid" | "generic" | "skuTaken" | "unitLocked" | null;

export function ProductForm({ productId, initial, unitLocked }: Props) {
  const t = useTranslations("admin.products.form");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sku, setSku] = useState(initial.sku);
  const [unit, setUnit] = useState(initial.unit);
  const [de, setDe] = useState(initial.de);
  const [hans, setHans] = useState(initial.hans);
  const [hk, setHk] = useState(initial.hk);
  const [tw, setTw] = useState(initial.tw);
  // New products start "auto"; an existing name stays "auto" only if it was machine-derived.
  const [hkAuto, setHkAuto] = useState(productId === null ? true : initial.hkAuto);
  const [twAuto, setTwAuto] = useState(productId === null ? true : initial.twAuto);
  const [error, setError] = useState<FormError>(null);
  const [hansMissing, setHansMissing] = useState(false);
  const requestId = useRef(0);

  // Live OpenCC pre-fill: every pause in typing re-derives the fields still marked "auto".
  useEffect(() => {
    if (!hkAuto && !twAuto) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      let derived: { ok: true; hk: string; tw: string } | { ok: false };
      try {
        derived = hans.trim() === "" ? { ok: true, hk: "", tw: "" } : await deriveHantAction(hans);
      } catch {
        return;
      }
      if (!derived.ok || id !== requestId.current) return; // stale answer
      if (hkAuto) setHk(derived.hk);
      if (twAuto) setTw(derived.tw);
    }, DERIVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hans, hkAuto, twAuto]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setHansMissing(hans.trim() === "");
    if (hans.trim() === "" || de.trim() === "" || sku.trim() === "") return setError("invalid");
    const input = { sku, unit, name: { de, hans, hk, tw }, hkAuto, twAuto };
    startTransition(async () => {
      let result;
      try {
        result = productId
          ? await updateProductAction(productId, input)
          : await createProductAction(input);
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        if (result.error === "sku_taken") return setError("skuTaken");
        if (result.error === "unit_locked") return setError("unitLocked");
        return setError(result.error === "not_found" ? "generic" : "invalid");
      }
      toast.success(t(productId ? "savedEdit" : "savedNew"));
      router.push("/admin/products");
      router.refresh();
    });
  }

  const autoBadge = (
    <Badge variant="secondary" data-testid="auto-badge">
      {t("auto")}
    </Badge>
  );

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-8" noValidate>
      <section className="flex flex-col gap-4" aria-labelledby="prod-data">
        <h2 id="prod-data" className="text-xl font-semibold">
          {t("dataHeading")}
        </h2>
        <FormField label={t("sku")} htmlFor="prod-sku" required className="max-w-xs">
          <Input
            id="prod-sku"
            value={sku}
            maxLength={32}
            onChange={(e) => {
              setSku(e.target.value);
              if (error === "skuTaken") setError(null);
            }}
            aria-invalid={error === "skuTaken" || undefined}
            required
            data-testid="product-sku"
          />
        </FormField>
        {error === "skuTaken" ? (
          <p className="-mt-2 max-w-xs text-sm text-destructive" role="alert" data-testid="sku-taken">
            {t("skuTaken")}
          </p>
        ) : (
          <p className="-mt-2 max-w-xs text-sm text-muted-foreground">{t("skuHint")}</p>
        )}
        <FormField
          label={t("unit")}
          htmlFor="prod-unit"
          className="max-w-xs"
          description={unitLocked ? t("unitLocked") : undefined}
        >
          <Select value={unit} disabled={unitLocked} onValueChange={(v) => setUnit(v as typeof unit)}>
            <SelectTrigger id="prod-unit" data-testid="product-unit" aria-label={t("unit")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {tc(`units.${u}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="prod-names">
        <h2 id="prod-names" className="text-xl font-semibold">
          {t("namesHeading")}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t("namesHint")}</p>
        <FormField label={t("nameDe")} htmlFor="prod-de" required className="max-w-xl">
          <Input
            id="prod-de"
            lang="de"
            value={de}
            maxLength={160}
            onChange={(e) => setDe(e.target.value)}
            required
            data-testid="product-name-de"
          />
        </FormField>
        <FormField label={t("nameHans")} htmlFor="prod-hans" required className="max-w-xl">
          <Input
            id="prod-hans"
            lang="zh-Hans"
            value={hans}
            maxLength={160}
            onChange={(e) => {
              setHans(e.target.value);
              setHansMissing(false);
            }}
            data-testid="product-name-hans"
          />
        </FormField>
        {hansMissing ? (
          <p className="-mt-2 max-w-xl text-sm text-destructive" role="alert" data-testid="hans-required">
            {t("hansRequired")}
          </p>
        ) : null}
        {(
          [
            ["hk", "zh-Hant-HK", hk, setHk, hkAuto, setHkAuto],
            ["tw", "zh-Hant-TW", tw, setTw, twAuto, setTwAuto],
          ] as const
        ).map(([key, lang, value, setValue, auto, setAuto]) => (
          <FormField
            key={key}
            label={t(key === "hk" ? "nameHk" : "nameTw")}
            htmlFor={`prod-${key}`}
            className="max-w-xl"
            hint={
              <span className="flex flex-wrap items-center gap-2">
                {auto ? autoBadge : null}
                {!auto ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAuto(true)}
                    data-testid={`rederive-${key}`}
                  >
                    <RefreshCwIcon aria-hidden />
                    {t("rederive")}
                  </Button>
                ) : null}
              </span>
            }
          >
            <Input
              id={`prod-${key}`}
              lang={lang}
              value={value}
              maxLength={160}
              onChange={(e) => {
                setValue(e.target.value);
                setAuto(false);
              }}
              data-testid={`product-name-${key}`}
            />
          </FormField>
        ))}
      </section>

      {error === "invalid" || error === "generic" || error === "unitLocked" ? (
        <p className="text-sm text-destructive" role="alert" data-testid="form-error">
          {error === "unitLocked"
            ? t("unitLockedError")
            : t(error === "invalid" ? "invalid" : "generic")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} data-testid="product-save">
          {tc("actions.save")}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/products">{tc("actions.cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
