"use client";

import { useTranslations } from "next-intl";

/**
 * What a refused new Draft (POST /v1/projects/:id/work-items) says, by the API's refusal code: the
 * New item page's and the phone's New Snag's (RP-630) alike. An unknown code reads "unavailable".
 */
export function useCreateRefusal(): (error: string | undefined) => string {
  const t = useTranslations("workItems");
  const messages: Record<string, string> = {
    invalid_request: t("invalid"),
    invalid_answers: t("form.invalid"),
    forbidden: t("notContractor"),
    outside_visibility: t("outsideVisibility"),
    // A Trade, Location or Scope removed meanwhile.
    value_not_found: t("form.valueNotFound"),
    project_closed: t("projectClosed"),
    form_version_not_latest: t("form.newVersion"),
    // An answer in a Form Section another Participant fills.
    not_editable: t("form.notEditable"),
  };
  return (error) => messages[error ?? ""] ?? t("unavailable");
}
