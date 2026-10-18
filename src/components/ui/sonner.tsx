"use client";

import { useTranslations } from "next-intl";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Toast host. Mount once (locale layout); call `toast(...)` from `sonner` anywhere on the client. */
function Toaster(props: ToasterProps) {
  const t = useTranslations("common");
  return (
    <Sonner
      theme="system"
      // The live region's name is read by screen readers: localized, without the "alt+T" hotkey hint.
      containerAriaLabel={t("notifications")}
      hotkey={[]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
