"use client";

import {
  offeredChoices,
  validateAnswers,
  type FieldError,
  type FormChoices,
  type FormValue,
  type FormVersion,
  type Locale,
} from "@rabaed/domain";
import { Button, Field, FormRenderer, Input, Select } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";

type Option = { id: string; label: string };

// A choice can't have an empty value, so "no Location" has its own.
const NO_LOCATION = "none";

/**
 * Creates a MAR in Draft, then opens it: its Subject, Trade and Location, then
 * its Form (the latest published Version). Required fields may stay empty in a
 * Draft; they are checked when it leaves Draft.
 */
export function CreateWorkItemForm({
  projectId,
  form,
  choices,
  trades,
  locations,
  locale,
}: {
  projectId: string;
  form: FormVersion;
  /** Who and which Companies its `member` and `participant` fields offer. */
  choices: FormChoices;
  trades: Option[];
  locations: Option[];
  locale: Locale;
}) {
  const t = useTranslations("workItems");
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<readonly FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function change(key: string, value: FormValue | undefined) {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    // Instant feedback with the same checks the server runs (draft mode: types only).
    const checked = validateAnswers(form.schema, next, "draft", offeredChoices(choices));
    setFieldErrors(checked.ok ? [] : checked.errors);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "MAR",
          title: data.get("title"),
          tradeId: data.get("tradeId"),
          locationId: data.get("locationId") === NO_LOCATION ? null : data.get("locationId"),
          answers,
        }),
      });
      if (res.status === 201) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/work-items/${id}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldError[] };
      if (body.error === "invalid_answers" && body.fields) setFieldErrors(body.fields);
      const errors: Record<string, string> = {
        invalid_request: t("invalid"),
        invalid_answers: t("form.invalid"),
        forbidden: t("notContractor"),
        outside_visibility: t("outsideVisibility"),
        project_closed: t("projectClosed"),
        form_version_not_latest: t("form.newVersion"),
      };
      setError(errors[body.error ?? ""] ?? t("unavailable"));
      // A newer Form Version was published meanwhile: show it.
      if (body.error === "form_version_not_latest") router.refresh();
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="space-y-4">
        <Field label={t("fields.subject")} id="title" required>
          <Input name="title" maxLength={200} dir="auto" />
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
      </div>
      <FormRenderer
        schema={form.schema}
        answers={answers}
        choices={choices}
        errors={fieldErrors}
        mode="edit"
        locale={locale}
        onChange={change}
        idPrefix="answer"
      />
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
