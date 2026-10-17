"use client";

import { MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { clampScale, type ViewState, zoomAt } from "@/lib/zoom";

type Props = {
  /** Signed read URL (see `Storage.getReadUrl`). */
  src: string;
  alt: string;
  className?: string;
  /** `contain` shows the whole image in the thumbnail (screenshots), `cover` crops it to fill. */
  fit?: "cover" | "contain";
};

/** Thumbnail that opens a fullscreen viewer with wheel / pinch / double-tap zoom and panning. */
export function ImagePreview({ src, alt, className, fit = "cover" }: Props) {
  const t = useTranslations("common.upload.preview");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`${t("open")}: ${alt}`}
          className={cn(
            "block overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, already resized */}
          <img
            src={src}
            alt={alt}
            className={cn("size-full", fit === "contain" ? "object-contain" : "object-cover")}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="h-dvh max-h-dvh w-screen max-w-none gap-0 rounded-none border-0 bg-black p-0 sm:max-w-none">
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <ZoomableImage src={src} alt={alt} />
      </DialogContent>
    </Dialog>
  );
}

const IDLE: ViewState = { scale: 1, x: 0, y: 0 };

/**
 * Zoomable, pannable image that fills its parent (which must have a height). Wheel zoom uses a
 * non-passive listener so the page does not scroll while zooming inline (NUD-031 split view).
 */
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const t = useTranslations("common.upload.preview");
  const [view, setView] = useState<ViewState>(IDLE);
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number } | null>(null);

  /** Pointer position relative to the frame centre (the transform origin). */
  function local(clientX: number, clientY: number) {
    const rect = frame.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }

  function onPointerDown(event: PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) pinch.current = { distance: distance(pointers.current) };
  }

  function onPointerMove(event: PointerEvent) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const next = distance(pointers.current);
      const [a, b] = [...pointers.current.values()];
      const centre = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const factor = next / pinch.current.distance;
      pinch.current = { distance: next };
      setView((v) => zoomAt(v, factor, centre));
    } else if (pointers.current.size === 1) {
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      setView((v) => (v.scale > 1 ? { ...v, x: v.x + dx, y: v.y + dy } : v));
    }
  }

  function onPointerUp(event: PointerEvent) {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    setView((v) => (v.scale <= 1 ? IDLE : v));
  }

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const centre = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
      setView((v) => zoomAt(v, event.deltaY < 0 ? 1.2 : 1 / 1.2, centre));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  function onDoubleClick(event: React.MouseEvent) {
    const centre = local(event.clientX, event.clientY);
    setView((v) => (v.scale > 1 ? IDLE : zoomAt(v, 2.5, centre)));
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      <div
        ref={frame}
        data-testid="zoom-frame"
        className="flex flex-1 touch-none items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, already resized */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          data-testid="zoom-image"
          data-scale={view.scale}
          className="max-h-full max-w-full select-none"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "center",
          }}
        />
      </div>
      <div className="absolute start-3 bottom-3 flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon-lg"
          aria-label={t("zoomOut")}
          onClick={() => setView((v) => zoomAt(v, 1 / 1.5, { x: 0, y: 0 }))}
        >
          <MinusIcon aria-hidden />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon-lg"
          aria-label={t("zoomIn")}
          onClick={() => setView((v) => zoomAt(v, 1.5, { x: 0, y: 0 }))}
        >
          <PlusIcon aria-hidden />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon-lg"
          aria-label={t("reset")}
          onClick={() => setView({ scale: clampScale(1), x: 0, y: 0 })}
        >
          <RotateCcwIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function distance(points: Map<number, { x: number; y: number }>) {
  const [a, b] = [...points.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}
