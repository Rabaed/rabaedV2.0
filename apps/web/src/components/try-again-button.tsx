"use client";

import { Button } from "@rabaed/ui";
import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";

/** Reads the page again on the server (RP-1049), busy until it has. */
export function TryAgainButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
      {label}
    </Button>
  );
}
