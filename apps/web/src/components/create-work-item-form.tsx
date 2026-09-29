"use client";

import { Button, Field, Input, Select, Textarea } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";

type Option = { id: string; label: string };

// A choice can't have an empty value, so "no Location" has its own.
const NO_LOCATION = "none";

/** Creates a MAR in Draft, then opens it. */
export function CreateWorkItemForm({
  projectId,
  trades,
  locations,
}: {
  projectId: string;
  trades: Option[];
  locations: Option[];
}) {
  const t = useTranslations("workItems");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "MAR",
          title: form.get("title"),
          tradeId: form.get("tradeId"),
          locationId: form.get("locationId") === NO_LOCATION ? null : form.get("locationId"),
          description: form.get("description"),
        }),
      });
      if (res.status === 201) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/work-items/${id}`);
        return;
      }
      const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
      const errors: Record<string, string> = {
        invalid_request: t("invalid"),
        forbidden: t("notContractor"),
        outside_visibility: t("outsideVisibility"),
        project_closed: t("projectClosed"),
      };
      setError(errors[code ?? ""] ?? t("unavailable"));
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label={t("fields.title")} id="title" required>
        <Input name="title" maxLength={200} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("fields.trade")} id="tradeId" required>
          <Select name="tradeId" defaultValue={trades[0]?.id} options={trades.map((o) => ({ value: o.id, label: o.label }))} />
        </Field>
        <Field label={t("fields.location")} id="locationId">
          <Select
            name="locationId"
            defaultValue={NO_LOCATION}
            options={[{ value: NO_LOCATION, label: t("noLocation") }, ...locations.map((o) => ({ value: o.id, label: o.label }))]}
          />
        </Field>
      </div>
      <Field label={t("fields.description")} id="description">
        <Textarea name="description" rows={5} maxLength={4000} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t("saveDraft")}
      </Button>
    </form>
  );
}
