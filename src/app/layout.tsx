import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nudel Liefer App",
  description: "Delivery management for a pasta factory",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
