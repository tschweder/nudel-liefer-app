import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";

async function NotFoundAtRequestTime(): Promise<ReactNode> {
  // Decided at request time: a prerendered shell would otherwise cache a bare, unlocalized 404.
  await connection();
  notFound();
}

/** Unknown paths below a valid locale render the localized `not-found.tsx`. */
export default function CatchAllPage() {
  return (
    <Suspense>
      <NotFoundAtRequestTime />
    </Suspense>
  );
}
