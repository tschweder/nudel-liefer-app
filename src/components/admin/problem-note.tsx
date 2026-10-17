"use client";

import { LanguagesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlanStop } from "@/server/tour-planning";

type Note = NonNullable<PlanStop["problemNote"]>;

/**
 * The driver's free-text problem note for the office (NUD-072): the German translation first,
 * marked as machine-translated, with a toggle for the driver's original. While the translation is
 * still pending the original is shown with a "translation pending" hint. A note written in German
 * is shown as is (it is its own original).
 */
export function ProblemNote({ note }: { note: Note }) {
  const t = useTranslations("admin.tours.progress");
  const [showOriginal, setShowOriginal] = useState(false);
  const translated = note.german !== null;
  const originalVisible = !translated || showOriginal;

  return (
    <div className="flex flex-col gap-1" data-testid="stop-problem-note">
      {translated ? (
        <p data-testid="stop-problem-german">
          <span className="text-muted-foreground">{t("translatedNote")} </span>
          <q lang="de" className="whitespace-pre-wrap">
            {note.german}
          </q>
          {note.germanMachine ? (
            <Badge variant="outline" className="ml-2 gap-1" data-testid="stop-problem-machine">
              <LanguagesIcon className="size-3.5" aria-hidden />
              {t("machineTranslated")}
            </Badge>
          ) : null}
        </p>
      ) : note.pending ? (
        <Badge variant="outline" className="w-fit gap-1" data-testid="stop-problem-pending">
          <LanguagesIcon className="size-3.5" aria-hidden />
          {t("translationPending")}
        </Badge>
      ) : null}
      {originalVisible ? (
        <p data-testid="stop-problem-original">
          <span className="text-muted-foreground">{t("originalNote")} </span>
          <q lang={note.locale} className="whitespace-pre-wrap">
            {note.text}
          </q>
        </p>
      ) : null}
      {translated ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto w-fit p-0"
          aria-expanded={showOriginal}
          data-testid="stop-problem-toggle"
          onClick={() => setShowOriginal((v) => !v)}
        >
          {showOriginal ? t("hideOriginal") : t("showOriginal")}
        </Button>
      ) : null}
    </div>
  );
}
