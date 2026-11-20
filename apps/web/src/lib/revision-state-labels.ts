"use client";

import type { RevisionStateLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";

/**
 * Where a Revision not yet Submitted stands, after its base number (RP-1314): the List's own words, "Draft" and
 * "Internal Review", so every screen that names such a Revision reads it as its page does.
 */
export function useRevisionStateLabels(): RevisionStateLabels {
  const t = useTranslations("workItemViews.list");
  return { revisionDraft: t("revisionDraft"), revisionInternalReview: t("revisionInternalReview") };
}
