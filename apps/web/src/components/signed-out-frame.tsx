"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { Link, usePathname } from "@/i18n/navigation";
import { hasOwnFrame } from "@/lib/sign-in-brand";

/** Signed out (accepting an invitation, the welcome): a header and a plain centred page. The sign-in page draws its own (RP-1057). */
export function SignedOutFrame({ children }: { children: ReactNode }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  if (hasOwnFrame(pathname)) return children;
  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-lg font-semibold">
          {t("appName")}
        </Link>
        <LanguageSwitch />
      </header>
      <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">{children}</main>
    </>
  );
}
