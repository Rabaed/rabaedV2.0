"use client";

import type { Locale, NumberingCounter, NumberingPattern, NumberingVersion, SaveNumberingRequest } from "@rabaed/domain";
import { DocumentNumbering, NumberingVersions, type NumberingContext, type NumberingTypeRow, type PatternChange, type SampleContext } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/**
 * Project Settings → Document Numbering (RP-412): the page's settings and its
 * Versions card, with the app's words. Saves each changed pattern through the API
 * (PUT /v1/projects/:id/numbering), the Project pattern first, then refreshes the
 * page; a refusal stops there and says why.
 */
export function DocumentNumberingSettings({
  projectId,
  versions,
  example,
  ...props
}: {
  projectId: string;
  canEdit: boolean;
  projectPattern: NumberingPattern;
  isRabaedDefault: boolean;
  types: NumberingTypeRow[];
  preview: NumberingContext;
  samples: SampleContext[];
  counters?: NumberingCounter[];
  tradeCodes: string[];
  versions: NumberingVersion[];
  example: NumberingContext["attributes"];
}) {
  const t = useTranslations("numbering.page");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const errors: Record<string, string> = {
    invalid_request: t("invalid"),
    invalid_pattern: t("invalid"),
    shared_counter_not_accepted: t("sharedCounterNotAccepted"),
    // No longer a Project Admin, or a Type removed from view.
    not_found: t("notFound"),
    type_not_found: t("notFound"),
    project_closed: t("projectClosed"),
  };

  const onSave = async (changes: PatternChange[], sharedCounterAccepted: boolean) => {
    try {
      for (const change of changes) {
        const body: SaveNumberingRequest = { ...change, sharedCounterAccepted };
        const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/numbering`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({}))) as { error?: string };
          router.refresh();
          return { ok: false as const, error: errors[error ?? ""] ?? t("unavailable") };
        }
      }
      router.refresh();
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: t("unavailable") };
    }
  };

  return (
    <>
      <DocumentNumbering t={t} onSave={onSave} {...props} />
      <NumberingVersions t={t} locale={locale} versions={versions} types={props.types} example={example} />
    </>
  );
}
