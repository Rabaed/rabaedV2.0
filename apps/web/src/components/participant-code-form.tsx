"use client";

import { Button, Field, Input } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * A Project Admin sets a Participant's Participant Code: 2 to 6 letters or
 * digits that stand for the Participant in Document Numbers. Fixed once a number
 * uses it. Codes are always left-to-right, like Document Numbers.
 */
export function ParticipantCodeForm({ participantId, code }: { participantId: string; code: string | null }) {
  const t = useTranslations("participants");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/participants/${encodeURIComponent(participantId)}/code`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: form.get("code") }),
      });
      if (res.status === 204) {
        setSaved(true);
        router.refresh();
        return;
      }
      const errors: Record<number, string> = {
        403: t("notAdmin"),
        409: (await res.json().catch(() => null))?.error === "code_in_use" ? t("codeInUse") : t("codeTaken"),
        422: t("codeInvalid"),
      };
      setError(errors[res.status] ?? t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4" noValidate>
      <Field label={t("participantCode")} help={t("participantCodeHelp")}>
        <Input name="code" dir="ltr" maxLength={6} defaultValue={code ?? ""} placeholder={t("noCode")} autoCapitalize="characters" />
      </Field>
      <Button type="submit" disabled={pending}>
        {t("saveCode")}
      </Button>
      {saved && (
        <p role="status" className="text-sm">
          {t("codeSaved")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
