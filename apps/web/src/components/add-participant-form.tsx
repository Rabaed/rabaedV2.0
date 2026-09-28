"use client";

import { baseRoles } from "@rabaed/domain";
import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

/** A Project Admin adds another Company, found by its CR number, as a Participant. */
export function AddParticipantForm({ projectId }: { projectId: string }) {
  const t = useTranslations("participants");
  const tRoles = useTranslations("projects.roles");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ crNumber: form.get("crNumber"), role: form.get("role") }),
      });
      if (res.status === 201) {
        formElement.reset();
        router.refresh();
        return;
      }
      const errors: Record<number, string> = {
        400: t("invalidCr"),
        403: t("notAdmin"),
        409: t("alreadyParticipant"),
        422: t("unknownCompany"),
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
      <div className="space-y-2">
        <Label htmlFor="participant-cr">{t("crNumber")}</Label>
        <Input id="participant-cr" name="crNumber" dir="ltr" inputMode="numeric" required maxLength={10} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="participant-role">{t("role")}</Label>
        <select
          id="participant-role"
          name="role"
          defaultValue="consultant"
          className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-sm"
        >
          {baseRoles.map((role) => (
            <option key={role} value={role}>
              {tRoles(role)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {t("add")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger sm:col-span-3">
          {error}
        </p>
      )}
    </form>
  );
}
