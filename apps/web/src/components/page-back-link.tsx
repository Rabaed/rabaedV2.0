"use client";

import { BackLink } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRememberedHref } from "@/components/remembered-module-queries";
import { Link } from "@/i18n/navigation";

/**
 * "← Back" above an inner page's title (RP-1241): back in this tab's history inside Rabaed,
 * otherwise to `parent`, the page's fixed parent. A parent that is a Module tab reopens with the
 * Member's remembered filters there (RP-1240).
 */
export function PageBackLink({ parent, className }: { parent: string; className?: string }) {
  const t = useTranslations("backLink");
  const remembered = useRememberedHref();
  return <BackLink href={remembered(parent)} label={t("label")} linkAs={Link} className={className} />;
}
