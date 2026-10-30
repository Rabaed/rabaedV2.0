"use client";

import type { Locale, WorkItemDetail } from "@rabaed/domain";
import { SubmittalPanelNumberCard, submittalNumberPlace, type SubmittalNumberSegment } from "@rabaed/ui";
import { useTranslations } from "next-intl";

/** Location levels by their place in the tree (1 = Zone), as the Numbering page names them. */
const levels = ["zone", "building", "floor"] as const;

/**
 * The Submittal Panel's ⓘ "How this number is built" (RP-1065): the item read's `numberSegments`,
 * each part explained from what the read already names (its Type, Trade, Location and raiser's
 * Company). Hidden when the read gives none.
 */
export function SubmittalPanelNumber({ item, locale, place }: { item: WorkItemDetail; locale: Locale; place: string[] }) {
  const t = useTranslations("submittalPanel.numberCard");
  const level = (segment: SubmittalNumberSegment) => t(`levels.${levels[(segment.level ?? 1) - 1] ?? "zone"}`);
  const line = (segment: SubmittalNumberSegment): string => {
    switch (segment.kind) {
      case "type":
        return item.type.name[locale];
      case "trade":
        return item.trade.name[locale];
      case "participant":
        return t("lines.participant", { company: item.raisedBy.companyName[locale] });
      case "location": {
        const name = submittalNumberPlace(segment.level ?? 1, place);
        return name ?? t("lines.location", { level: level(segment) });
      }
      default:
        return t(`lines.${segment.kind}`);
    }
  };
  return (
    <SubmittalPanelNumberCard
      segments={item.numberSegments}
      labels={{
        title: t("title"),
        footnote: t("footnote"),
        kind: (segment) => (segment.kind === "location" ? level(segment) : t(`kinds.${segment.kind}`)),
        line,
      }}
    />
  );
}
