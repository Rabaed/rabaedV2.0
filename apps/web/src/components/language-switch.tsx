"use client";

import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@rabaed/ui";
import { Link, usePathname } from "@/i18n/navigation";

export function LanguageSwitch() {
  const t = useTranslations("shell");
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "ar" ? "en" : "ar";

  return (
    <Link
      href={pathname}
      locale={other}
      hrefLang={other}
      lang={other}
      className={buttonVariants({ variant: "secondary", size: "sm" })}
      data-testid="language-switch"
    >
      {t("switchLanguage")}
    </Link>
  );
}
