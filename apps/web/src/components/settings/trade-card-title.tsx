"use client";

import type { Locale } from "@rabaed/domain";
import { Badge } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import type { SettingsTrade } from "@/lib/settings-trades";

/**
 * A Trade's card title on a settings list (Approved Supplier List, Checklist Templates): its name
 * and code, and "Archived" when it is deactivated and kept for the records on it (RP-1251).
 */
export function TradeCardTitle({ trade }: { trade: SettingsTrade }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("tradesLocations");
  return (
    <>
      {trade.name[locale]}{" "}
      <bdi dir="ltr" translate="no" className="text-caption font-normal text-muted">
        {trade.code}
      </bdi>
      {!trade.active && (
        <>
          {" "}
          <Badge tone="neutral">{t("archived")}</Badge>
        </>
      )}
    </>
  );
}
