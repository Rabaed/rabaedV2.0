"use client";

import type { Locale, ProjectParticipant } from "@rabaed/domain";
import { ParticipantCodes, type ParticipantCodeRefusal } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { useRouter } from "@/i18n/navigation";

/** The refusal a status of PUT /v1/participants/:id/code stands for. */
async function refusalOf(res: Response): Promise<ParticipantCodeRefusal> {
  if (res.status === 422) return "invalid";
  if (res.status === 403) return "forbidden";
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error === "code_in_use" ? "code_in_use" : "duplicate_code";
  }
  return "unavailable";
}

/**
 * Project Settings → Numbering: the Participant Codes (RP-381), set here by a
 * Project Admin, read by every other Project Member. Shows only the Participants
 * the API listed for the viewer (V15). Calls the API through the web's /api proxy
 * and refreshes the page after a code is saved.
 */
export function ParticipantCodesSection({ participants, canEdit }: { participants: ProjectParticipant[]; canEdit: boolean }) {
  const t = useTranslations("numbering.participantCodes");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const onSave = useCallback(
    async (participantId: string, code: string) => {
      const res = await fetch(`/api/v1/participants/${encodeURIComponent(participantId)}/code`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.status === 204) {
        router.refresh();
        return { ok: true as const };
      }
      return { ok: false as const, reason: await refusalOf(res) };
    },
    [router],
  );

  return (
    <ParticipantCodes
      locale={locale}
      participants={participants}
      canEdit={canEdit}
      labels={{
        title: t("title"),
        intro: t("intro"),
        participants: t("participants"),
        code: t("code"),
        position: t("position"),
        save: t("save"),
        saved: t("saved"),
        refusals: {
          invalid: t("invalid"),
          duplicate_code: t("duplicateCode"),
          code_in_use: t("codeInUse"),
          forbidden: t("forbidden"),
          unavailable: t("unavailable"),
        },
      }}
      onSave={onSave}
    />
  );
}
