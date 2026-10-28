"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn, focusRing } from "@rabaed/ui";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * English and العربية side by side, the current one raised, as on the owner's sign-in design (RP-1057).
 * Links, not a radio group: choosing one opens the same page in that language.
 */
export function LanguageChoice({ className }: { className?: string }) {
  const t = useTranslations("shell");
  const names = useTranslations("signIn.languages");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("language")} className={cn("inline-flex gap-0.5 rounded-md border border-border bg-surface-subtle p-0.75", className)}>
      {routing.locales.map((option) => (
        <Link
          key={option}
          href={pathname}
          locale={option}
          hrefLang={option}
          lang={option}
          aria-current={option === locale ? "page" : undefined}
          className={cn(
            "inline-flex h-7.5 items-center rounded-sm px-3 text-sm font-semibold text-muted hover:text-text",
            "aria-[current=page]:bg-surface aria-[current=page]:text-text aria-[current=page]:shadow-sm",
            "pointer-coarse:min-h-11",
            focusRing,
          )}
        >
          {names(option)}
        </Link>
      ))}
    </nav>
  );
}
