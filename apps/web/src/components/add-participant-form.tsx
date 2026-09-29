"use client";

import { baseRoles } from "@rabaed/domain";
import { Button, Field, Input, Select } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * A Project Admin invites another Company, found by its CR number. The answer
 * is the same whether or not the CR number is on Rabaed (ADR 0009).
 */
export function AddParticipantForm({ projectId }: { projectId: string }) {
  const t = useTranslations("participants");
  const tRoles = useTranslations("projects.roles");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ crNumber: form.get("crNumber"), role: form.get("role") }),
      });
      if (res.status === 202) {
        formElement.reset();
        setSent(true);
        router.refresh();
        return;
      }
      const errors: Record<number, string> = {
        400: t("invalidCr"),
        403: t("notAdmin"),
        409: t("alreadyParticipant"),
      };
      setError(errors[res.status] ?? t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-3" noValidate>
      <Field label={t("crNumber")} id="participant-cr" required>
        <Input name="crNumber" dir="ltr" inputMode="numeric" maxLength={10} />
      </Field>
      <Field label={t("role")} id="participant-role">
        <Select name="role" defaultValue="consultant" options={baseRoles.map((role) => ({ value: role, label: tRoles(role) }))} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {t("invite")}
        </Button>
      </div>
      {sent && (
        <p role="status" className="text-sm sm:col-span-3">
          {t("invitationSent")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger sm:col-span-3">
          {error}
        </p>
      )}
    </form>
  );
}
